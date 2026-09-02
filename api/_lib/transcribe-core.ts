/**
 * Framework-agnostic transcription proxy. Used by the Vercel function (api/transcribe.ts) and by the
 * Vite dev middleware so `npm run dev` works locally with OPENAI_API_KEY in .env.
 * The API key never leaves the server.
 */
export interface TranscribeResult {
  status: number;
  body: Record<string, unknown>;
}

const MAX_BYTES = 24 * 1024 * 1024;
const FILLER_PROMPT = 'Um, uh, hmm, like, you know, so. Keep filler words, false starts and pauses as spoken.';

export async function transcribeCore(body: Uint8Array, contentType: string, env: Record<string, string | undefined>): Promise<TranscribeResult> {
  const key = env.OPENAI_API_KEY;
  if (!key) return { status: 500, body: { error: 'OPENAI_API_KEY is not configured on the server. Add it in Vercel project settings or .env for local dev.' } };
  if (!body.length) return { status: 400, body: { error: 'Empty body. Send raw audio bytes with an audio/* content-type.' } };
  if (body.length > MAX_BYTES) return { status: 413, body: { error: `Audio chunk too large (${body.length} bytes).` } };

  const type = contentType.split(';')[0].trim() || 'audio/wav';
  const ext = type.includes('wav') ? 'wav' : type.includes('mpeg') || type.includes('mp3') ? 'mp3' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('flac') ? 'flac' : 'webm';
  const model = env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

  const form = new FormData();
  form.append('file', new Blob([body], { type }), `audio.${ext}`);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('prompt', FILLER_PROMPT);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try { message = JSON.parse(text)?.error?.message ?? text; } catch { /* raw */ }
    return { status: res.status === 401 ? 500 : res.status, body: { error: `OpenAI transcription failed (${res.status}): ${message}` } };
  }
  const j = (await res.json()) as {
    text?: string; language?: string; duration?: number;
    words?: { word: string; start: number; end: number }[];
    segments?: { id: number; text: string; start: number; end: number }[];
  };
  return {
    status: 200,
    body: {
      text: j.text ?? '',
      language: j.language,
      duration: j.duration,
      model,
      words: (j.words ?? []).map((w) => ({ text: w.word, start: w.start, end: w.end })),
      segments: (j.segments ?? []).map((s) => ({ id: s.id, text: s.text.trim(), start: s.start, end: s.end })),
    },
  };
}
