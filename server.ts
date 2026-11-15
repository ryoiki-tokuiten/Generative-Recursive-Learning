import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer, loadEnv } from 'vite';
import { initDb, getAllRuns, getRun, syncRun, deleteRun } from './services/dbServer.ts';
import { generateLessonFromPrompt, streamLessonFromPrompt } from './services/geminiServer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const mode = process.env.NODE_ENV || 'development';
  const env = loadEnv(mode, process.cwd(), '');
  process.env.DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Initialize database tables on startup
  try {
    await initDb();
  } catch (err) {
    console.error('[Server] Database initialization failed:', err);
  }

  // --- Database API Routes ---

  // 1. GET /api/runs - Fetch all previous runs
  app.get('/api/runs', async (_req, res) => {
    try {
      const runs = await getAllRuns();
      res.status(200).json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch runs' });
    }
  });

  // 2. GET /api/runs/:id - Load specific run and its node graph
  app.get('/api/runs/:id', async (req, res) => {
    try {
      const run = await getRun(req.params.id);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
      } else {
        res.status(200).json(run);
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load run' });
    }
  });

  // 3. POST /api/runs/:id/sync - Sync nodeMap graph and active state
  app.post('/api/runs/:id/sync', async (req, res) => {
    try {
      const { title, rootNodeId, currentNodeId, nodeMap } = req.body || {};
      const result = await syncRun(req.params.id, title, rootNodeId, currentNodeId, nodeMap);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to sync run' });
    }
  });

  // 4. DELETE /api/runs/:id - Delete a run
  app.delete('/api/runs/:id', async (req, res) => {
    try {
      const result = await deleteRun(req.params.id);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to delete run' });
    }
  });

  // --- Gemini API Routes ---

  // POST /api/gemini/generate - Generate lesson HTML from prompt
  app.post('/api/gemini/generate', async (req, res) => {
    try {
      const { prompt, model } = req.body || {};
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Missing required prompt string' });
        return;
      }

      const html = await generateLessonFromPrompt(prompt, model);
      res.status(200).json({ html });
    } catch (err: any) {
      console.error('Gemini API Error:', err);
      res.status(500).json({ error: err?.message || 'Failed to generate lesson content' });
    }
  });

  // POST /api/gemini/stream - Stream lesson generation via SSE
  app.post('/api/gemini/stream', async (req, res) => {
    try {
      const { prompt, model } = req.body || {};
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Missing required prompt string' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const streamResponse = await streamLessonFromPrompt(prompt, model);
      for await (const chunk of streamResponse) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      console.error('Gemini Stream Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Failed to stream lesson content' });
      } else {
        res.write(`data: ${JSON.stringify({ error: err?.message || 'Stream error' })}\n\n`);
        res.end();
      }
    }
  });

  // --- Vite Middleware / Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
