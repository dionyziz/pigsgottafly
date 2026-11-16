// Development server: Vite in middleware mode (hot reload) + the API, one port.
//   npm run dev → http://127.0.0.1:8765/
import { createServer as createVite } from 'vite';
import { ROOT, listenFromEnv } from './server.js';

const vite = await createVite({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
await listenFromEnv(
  (req, res) =>
    new Promise<void>((resolve) => {
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end('not found');
        resolve();
      });
      res.on('finish', () => resolve());
    }),
);
