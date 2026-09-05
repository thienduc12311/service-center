import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.info(`service-center api listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

const shutdown = (signal: string) => () => {
  console.info(`\n${signal} received, shutting down`);
  server.close(() => process.exit(0));
  // Don't let a hung connection block a container restart.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));
