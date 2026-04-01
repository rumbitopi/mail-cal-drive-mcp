import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../logger.js';

const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastAccessed: number;
}

const sessions: Map<string, SessionEntry> = new Map();

// Periodic cleanup of expired sessions
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, entry] of sessions.entries()) {
    if (now - entry.lastAccessed > SESSION_TTL_MS) {
      entry.transport.close().catch(() => {});
      sessions.delete(sessionId);
      logger.debug('Session expired', { sessionId });
    }
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref(); // Don't prevent process exit

export function getSession(sessionId: string): StreamableHTTPServerTransport | undefined {
  const entry = sessions.get(sessionId);
  if (!entry) return undefined;

  // Check TTL
  if (Date.now() - entry.lastAccessed > SESSION_TTL_MS) {
    entry.transport.close().catch(() => {});
    sessions.delete(sessionId);
    return undefined;
  }

  entry.lastAccessed = Date.now();
  return entry.transport;
}

export function setSession(sessionId: string, transport: StreamableHTTPServerTransport): void {
  // Enforce max sessions
  if (sessions.size >= MAX_SESSIONS && !sessions.has(sessionId)) {
    // Evict oldest session
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, entry] of sessions.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestId = id;
      }
    }
    if (oldestId) {
      const evicted = sessions.get(oldestId);
      evicted?.transport.close().catch(() => {});
      sessions.delete(oldestId);
      logger.debug('Session evicted (max reached)', { sessionId: oldestId });
    }
  }

  sessions.set(sessionId, { transport, lastAccessed: Date.now() });
  logger.info('MCP session created', { sessionId, totalSessions: sessions.size });
}

export function deleteSession(sessionId: string): boolean {
  const entry = sessions.get(sessionId);
  if (!entry) return false;
  sessions.delete(sessionId);
  logger.info('MCP session removed', { sessionId, totalSessions: sessions.size });
  return true;
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function getSessionCount(): number {
  return sessions.size;
}

export function getSessionIds(): string[] {
  return Array.from(sessions.keys());
}

export async function closeAllSessions(): Promise<void> {
  logger.info('Closing all MCP sessions', { count: sessions.size });
  clearInterval(cleanupTimer);

  const closePromises: Promise<void>[] = [];
  for (const [sessionId, entry] of sessions.entries()) {
    closePromises.push(
      entry.transport.close().catch((error) => {
        logger.error('Error closing session', error, { sessionId });
      })
    );
  }

  await Promise.all(closePromises);
  sessions.clear();
  logger.info('All MCP sessions closed');
}
