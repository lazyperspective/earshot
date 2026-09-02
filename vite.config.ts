/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { transcribeCore } from './api/transcribe';

/** Dev-only stand-in for the Vercel function so `npm run dev` can transcribe with OPENAI_API_KEY in .env. */
function apiDevPlugin(): Plugin {
  return {
    name: 'earshot-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/transcribe', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'POST raw audio bytes to this endpoint.' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
          const env = { ...process.env, ...loadEnv('development', process.cwd(), '') };
          const r = await transcribeCore(new Uint8Array(Buffer.concat(chunks)), String(req.headers['content-type'] ?? 'audio/wav'), env);
          res.statusCode = r.status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(r.body));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiDevPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
