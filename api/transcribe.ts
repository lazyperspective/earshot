import type { VercelRequest, VercelResponse } from '@vercel/node';
import { transcribeCore } from './_lib/transcribe-core';

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST raw audio bytes to this endpoint.' });
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  const body = Buffer.concat(chunks);
  const result = await transcribeCore(new Uint8Array(body), String(req.headers['content-type'] ?? 'audio/wav'), process.env);
  res.status(result.status).json(result.body);
}
