import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { logger, logMcpCall } from '../logger.js';
import { getSession, setSession, deleteSession } from './session.js';
import { registerAllTools } from './tools/index.js';

/**
 * Create a new MCP server instance with all tools registered
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'workspace-mcp',
    version: '1.0.0',
  });

  // Register all tools
  registerAllTools(server);

  return server;
}

/**
 * Handle POST /mcp requests
 * - Reuses existing session if mcp-session-id header present
 * - Creates new session for initialize requests
 */
export async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId) {
      // Try to reuse existing session
      const existingTransport = getSession(sessionId);
      if (existingTransport) {
        transport = existingTransport;
        logMcpCall('reuse-session', { sessionId });
      } else {
        // Session expired or invalid
        logger.warn('Invalid session ID', { sessionId });
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Invalid or expired session' },
          id: null,
        });
        return;
      }
    } else if (isInitializeRequest(req.body)) {
      // Create new session for initialize request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          setSession(id, transport);
          logMcpCall('session-initialized', { sessionId: id });
        },
        onsessionclosed: (id) => {
          deleteSession(id);
          logMcpCall('session-closed', { sessionId: id });
        },
      });

      // Create and connect MCP server
      const server = createMcpServer();
      // Type assertion needed due to exactOptionalPropertyTypes strictness
      await server.connect(transport as Parameters<typeof server.connect>[0]);

      logMcpCall('new-session', { method: 'initialize' });
    } else {
      // Non-initialize request without session ID
      logger.warn('Missing session ID for non-initialize request');
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Session ID required. Send initialize request first.',
        },
        id: req.body?.id ?? null,
      });
      return;
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error('MCP request failed', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal server error' },
      id: req.body?.id ?? null,
    });
  }
}

/**
 * Handle GET /mcp requests (SSE stream for notifications)
 */
export async function handleMcpGet(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string;

  if (!sessionId) {
    res.status(400).json({
      error: 'Missing mcp-session-id header',
    });
    return;
  }

  const transport = getSession(sessionId);
  if (!transport) {
    res.status(400).json({
      error: 'Invalid or expired session',
    });
    return;
  }

  try {
    logMcpCall('sse-connect', { sessionId });
    await transport.handleRequest(req, res);
  } catch (error) {
    logger.error('SSE connection failed', error, { sessionId });
    res.status(500).json({
      error: 'Failed to establish SSE connection',
    });
  }
}

/**
 * Handle DELETE /mcp requests (session termination)
 */
export async function handleMcpDelete(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string;

  if (!sessionId) {
    res.status(400).json({
      error: 'Missing mcp-session-id header',
    });
    return;
  }

  const transport = getSession(sessionId);
  if (!transport) {
    res.status(400).json({
      error: 'Invalid or expired session',
    });
    return;
  }

  try {
    logMcpCall('session-terminate', { sessionId });
    await transport.handleRequest(req, res);
  } catch (error) {
    logger.error('Session termination failed', error, { sessionId });
    res.status(500).json({
      error: 'Failed to terminate session',
    });
  }
}
