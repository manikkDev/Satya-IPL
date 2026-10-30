// server.js
import env from './config/env.js';
import app from "./businessApp.js";

// When running on Vercel serverless, export the Express app as the default handler.
// When running locally (e.g., `node backend/src/server.js`), start the HTTP server.
const isVercel = !!process.env.VERCEL;

if (!isVercel) {
  const PORT = env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`Environment: ${env.NODE_ENV || 'development'}`);
    // Warm the RAG help index in the background — the first copilot request
    // shouldn't pay the 32-article embed cost inline.
    import('./rag/index.js')
      .then(({ getRag }) => getRag())
      .then((rag) => { if (rag) console.log('[rag] help index warm'); })
      .catch(() => undefined);
  });
}

export default app;
