/**
 * Google OAuth callback handler.
 * Reads pending flow from Postgres.
 */

import { Request, Response } from 'express';
import { logger, logAuth } from '../logger.js';
import { getGoogleAuthFlow } from '../mcp/tools/auth.js';
import { findPendingFlowByState, updatePendingFlow } from '../storage/pending-flows.js';
import { getCredentialStorage } from '../auth/storage.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Handle Google OAuth callback
 * GET /auth/google/callback?code=...&state=...
 */
export async function handleGoogleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.warn('Google OAuth error', { error, description: error_description });
    const safeError = escapeHtml(String(error));
    const safeDesc = escapeHtml(String(error_description || 'Please try again.'));
    res.status(400).send(`
      <html><body>
        <h1>Authentication Failed</h1>
        <p>Error: ${safeError}</p>
        <p>${safeDesc}</p>
      </body></html>
    `);
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(400).send(`
      <html><body>
        <h1>Authentication Failed</h1>
        <p>Missing authorization code.</p>
      </body></html>
    `);
    return;
  }

  if (!state || typeof state !== 'string') {
    res.status(400).send(`
      <html><body>
        <h1>Authentication Failed</h1>
        <p>Missing or invalid state parameter.</p>
      </body></html>
    `);
    return;
  }

  const pendingFlow = await findPendingFlowByState(state);
  if (!pendingFlow) {
    logger.warn('Invalid OAuth state', { state });
    res.status(400).send(`
      <html><body>
        <h1>Authentication Failed</h1>
        <p>Invalid or expired state. Please start a new auth flow.</p>
      </body></html>
    `);
    return;
  }

  try {
    logAuth('callback-received', 'google', { accountName: pendingFlow.account_name });

    const googleAuth = getGoogleAuthFlow();
    const credentials = await googleAuth.handleCallback(code, state);

    if (!credentials) {
      throw new Error('Failed to exchange authorization code for tokens');
    }

    const storage = getCredentialStorage();
    await storage.saveAccount(credentials);

    await updatePendingFlow(pendingFlow.id, {
      ...pendingFlow.flow_data,
      completed: true,
      credentials: {
        accountId: credentials.accountId,
        accountName: credentials.accountName,
        email: credentials.email,
        provider: credentials.provider,
      },
    });

    const safeName = escapeHtml(credentials.accountName);
    const safeEmail = escapeHtml(credentials.email);
    const safeId = escapeHtml(pendingFlow.id);

    res.send(`
      <html><body>
        <h1>Authentication Successful</h1>
        <p>Your Google account has been connected successfully.</p>
        <p>Account: ${safeName}</p>
        <p>Email: ${safeEmail}</p>
        <p>Auth ID: <code>${safeId}</code></p>
        <p>You can close this window. Return to Claude and call <code>auth_complete</code> with the Auth ID above to finish setup.</p>
      </body></html>
    `);
  } catch (err) {
    logger.error('Google OAuth callback failed', err);

    await updatePendingFlow(pendingFlow.id, {
      ...pendingFlow.flow_data,
      error: err instanceof Error ? err.message : 'Unknown error',
    });

    res.status(500).send(`
      <html><body>
        <h1>Authentication Failed</h1>
        <p>An unexpected error occurred. Please try again.</p>
      </body></html>
    `);
  }
}
