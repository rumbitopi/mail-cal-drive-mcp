import { config } from './config.js';
import { logger } from './logger.js';
import { createServer } from './server.js';
import { closePool } from './storage/postgres.js';
import { closeAllSessions } from './mcp/session.js';

async function main(): Promise<void> {
  logger.info('Starting Workspace MCP Server', {
    nodeEnv: config.NODE_ENV,
    port: config.MCP_PORT,
    providers: {
      microsoft: config.MS_ENABLED,
      google: config.GOOGLE_ENABLED,
      imap: config.IMAP_ENABLED,
    },
  });

  const app = createServer();

  const server = app.listen(config.MCP_PORT, () => {
    logger.info(`Server listening on port ${config.MCP_PORT}`);
    logger.info(`Health check: http://localhost:${config.MCP_PORT}/health`);
    logger.info(`MCP endpoint: http://localhost:${config.MCP_PORT}/mcp`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    await closeAllSessions();
    await closePool();

    server.close((err) => {
      if (err) {
        logger.error('Error during server shutdown', err);
        process.exit(1);
      }
      logger.info('Server closed');
      process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
