/**
 * Structured console logger.
 * Writes to stderr to keep stdout clean for MCP JSON-RPC.
 */

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

function log(level: LogLevel, message: string, meta?: object): void {
  if (!shouldLog(level)) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  console.error(JSON.stringify(entry));
}

export const logger = {
  error: (message: string, error?: unknown, meta?: object) => {
    const errorMeta =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
        : error
          ? { error: String(error) }
          : {};
    log('error', message, { ...errorMeta, ...meta });
  },
  warn: (message: string, error?: unknown, meta?: object) => {
    const errorMeta =
      error instanceof Error
        ? { errorMessage: error.message }
        : error
          ? { detail: String(error) }
          : {};
    log('warn', message, { ...errorMeta, ...meta });
  },
  info: (message: string, meta?: object) => log('info', message, meta),
  debug: (message: string, meta?: object) => log('debug', message, meta),
};

export function logRequest(method: string, path: string, meta?: object): void {
  logger.info(`${method} ${path}`, { type: 'request', ...meta });
}

export function logMcpCall(tool: string, meta?: object): void {
  logger.debug(`MCP tool call: ${tool}`, { type: 'mcp', tool, ...meta });
}

export function logAuth(action: string, provider: string, meta?: object): void {
  logger.info(`Auth ${action}: ${provider}`, { type: 'auth', action, provider, ...meta });
}

export function logError(message: string, error: unknown, meta?: object): void {
  logger.error(message, error, { type: 'error', ...meta });
}
