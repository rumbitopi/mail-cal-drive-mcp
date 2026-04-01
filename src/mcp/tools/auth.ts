/**
 * Authentication MCP tools.
 * Handles account setup, status, and revocation.
 * Pending auth flows stored in Postgres.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getProviderRegistry } from '../../providers/index.js';
import { getCredentialStorage } from '../../auth/storage.js';
import {
  getMicrosoftAuth,
  requestDeviceCode,
  pollDeviceCodeToken,
  seedMsalCacheFromTokens,
} from '../../providers/microsoft/auth.js';
import { getGoogleAuth, GoogleAuth } from '../../providers/google/auth.js';
import {
  MicrosoftCredentials,
  GoogleCredentials,
  ImapCredentials,
} from '../../auth/types.js';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import {
  createPendingFlow,
  getPendingFlow,
  updatePendingFlow,
  deletePendingFlow,
} from '../../storage/pending-flows.js';

/**
 * Register authentication tools with the MCP server.
 */
export function registerAuthTools(server: McpServer): void {
  // auth_status - List all configured accounts with connection status
  server.tool(
    'auth_status',
    'List all configured accounts with their connection status',
    {},
    async () => {
      try {
        const registry = getProviderRegistry();
        const accounts = await registry.listAccounts();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accounts: accounts.map((a) => ({
                    id: a.id,
                    name: a.name,
                    provider: a.provider,
                    email: a.email,
                    capabilities: a.capabilities,
                    connected: a.connected,
                  })),
                  count: accounts.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // auth_start - Start OAuth flow or set up IMAP credentials
  server.tool(
    'auth_start',
    'Start authentication for a new account. Microsoft: returns device code URL. Google: returns OAuth URL. Both require auth_complete afterward. IMAP: completes immediately.',
    {
      provider: z.enum(['microsoft', 'google', 'imap']).describe('Provider type'),
      accountName: z.string().describe('Friendly name for the account'),
      imapHost: z.string().optional().describe('IMAP server hostname (required for IMAP)'),
      imapPort: z.number().optional().describe('IMAP server port (default: 993)'),
      imapUsername: z.string().optional().describe('IMAP username (required for IMAP)'),
      imapPassword: z.string().optional().describe('IMAP password (required for IMAP)'),
      imapTls: z.boolean().optional().describe('Use TLS (default: true)'),
      email: z.string().optional().describe('Email address (required for IMAP)'),
    },
    async (args) => {
      try {
        const { provider, accountName } = args;

        if (provider === 'imap') {
          if (!args.imapHost || !args.imapUsername || !args.imapPassword || !args.email) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'IMAP requires imapHost, imapUsername, imapPassword, and email',
                  }),
                },
              ],
              isError: true,
            };
          }

          const accountId = `imap-${randomUUID()}`;
          const credentials: ImapCredentials = {
            accountId,
            accountName,
            email: args.email,
            provider: 'imap',
            host: args.imapHost,
            port: args.imapPort ?? 993,
            username: args.imapUsername,
            password: args.imapPassword,
            tls: args.imapTls ?? true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const storage = getCredentialStorage();
          await storage.saveAccount(credentials);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  requiresCompletion: false,
                  accountId,
                  accountName,
                  email: args.email,
                  message: 'IMAP account configured successfully. No need to call auth_complete.',
                }),
              },
            ],
          };
        } else if (provider === 'microsoft') {
          // Direct HTTP device code request (non-blocking, serverless-compatible)
          const authId = `ms-${randomUUID()}`;
          const deviceCodeResponse = await requestDeviceCode();

          // Store in Postgres
          await createPendingFlow(authId, 'microsoft', accountName, {
            device_code: deviceCodeResponse.device_code,
            user_code: deviceCodeResponse.user_code,
            verification_uri: deviceCodeResponse.verification_uri,
            expires_in: deviceCodeResponse.expires_in,
            interval: deviceCodeResponse.interval,
            completed: false,
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  authId,
                  provider: 'microsoft',
                  requiresCompletion: true,
                  verificationUrl: deviceCodeResponse.verification_uri,
                  userCode: deviceCodeResponse.user_code,
                  message: `Go to ${deviceCodeResponse.verification_uri} and enter code: ${deviceCodeResponse.user_code}`,
                  expiresInSeconds: deviceCodeResponse.expires_in,
                }),
              },
            ],
          };
        } else if (provider === 'google') {
          const authId = `google-${randomUUID()}`;
          const state = randomUUID();

          const googleAuth = getGoogleAuth();
          const authUrl = googleAuth.getAuthUrl(accountName, state);

          // Store in Postgres with state for callback lookup
          await createPendingFlow(
            authId,
            'google',
            accountName,
            {
              authUrl,
              completed: false,
            },
            state
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  authId,
                  provider: 'google',
                  requiresCompletion: true,
                  authUrl,
                  message: `Visit this URL to authorize: ${authUrl}`,
                  callbackNote: `After authorization, Google will redirect to ${config.GOOGLE_REDIRECT_URI}. Then call auth_complete with authId to finish.`,
                }),
              },
            ],
          };
        }

        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Invalid provider' }) },
          ],
          isError: true,
        };
      } catch (error) {
        logger.error('auth_start failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // auth_complete - Complete pending auth flow
  server.tool(
    'auth_complete',
    'Complete a pending authentication flow. For Microsoft, polls for device code completion. For Google, checks if OAuth callback was received.',
    {
      authId: z.string().describe('The auth ID returned from auth_start'),
    },
    async (args) => {
      try {
        const pending = await getPendingFlow(args.authId);

        if (!pending) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Auth flow not found or expired',
                  hint: 'Start a new auth flow with auth_start',
                }),
              },
            ],
            isError: true,
          };
        }

        const flowData = pending.flow_data;

        if (pending.provider === 'microsoft') {
          // Poll Microsoft token endpoint
          const deviceCode = flowData.device_code as string;
          const tokenResult = await pollDeviceCodeToken(deviceCode);

          if (!tokenResult) {
            // Still pending
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    pending: true,
                    message: 'Waiting for user to complete device code flow',
                    verificationUrl: flowData.verification_uri,
                    userCode: flowData.user_code,
                  }),
                },
              ],
            };
          }

          // Token received — seed MSAL cache and save credentials
          const { email, homeAccountId } = await seedMsalCacheFromTokens(
            tokenResult.access_token,
            tokenResult.refresh_token || '',
            tokenResult.id_token,
            tokenResult.expires_in
          );

          const accountId = `ms-${randomUUID()}`;
          const credentials: MicrosoftCredentials = {
            accountId,
            accountName: pending.account_name,
            email,
            provider: 'microsoft',
            accessToken: tokenResult.access_token,
            refreshToken: tokenResult.refresh_token || homeAccountId,
            expiresAt: new Date(Date.now() + tokenResult.expires_in * 1000),
            homeAccountId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const storage = getCredentialStorage();
          await storage.saveAccount(credentials);
          await deletePendingFlow(args.authId);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  accountId,
                  accountName: pending.account_name,
                  email,
                  provider: 'microsoft',
                  message: 'Microsoft account authenticated successfully',
                }),
              },
            ],
          };
        } else if (pending.provider === 'google') {
          // Check if callback updated the flow
          if (flowData.completed && flowData.credentials) {
            const creds = flowData.credentials as GoogleCredentials;
            await deletePendingFlow(args.authId);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    accountId: creds.accountId,
                    accountName: creds.accountName,
                    email: creds.email,
                    provider: 'google',
                    message: 'Google account authenticated successfully',
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  pending: true,
                  message: 'Waiting for OAuth callback',
                  authUrl: flowData.authUrl,
                }),
              },
            ],
          };
        }

        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Unknown provider' }) },
          ],
          isError: true,
        };
      } catch (error) {
        logger.error('auth_complete failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // auth_revoke - Remove account and revoke credentials
  server.tool(
    'auth_revoke',
    'Remove an account and revoke its credentials',
    {
      accountId: z.string().describe('The account ID to revoke'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const storage = getCredentialStorage();

        const credentials = await storage.getAccount(args.accountId);

        if (!credentials) {
          return {
            content: [
              { type: 'text', text: JSON.stringify({ error: 'Account not found' }) },
            ],
            isError: true,
          };
        }

        // Revoke tokens at provider level
        try {
          if (credentials.provider === 'google') {
            const googleAuth = getGoogleAuth();
            await googleAuth.revokeToken(credentials.accessToken);
          } else if (credentials.provider === 'microsoft') {
            const msAuth = getMicrosoftAuth();
            await msAuth.signOut(credentials.homeAccountId);
          }
        } catch (revokeError) {
          logger.warn('Token revocation failed, continuing with local deletion', revokeError);
        }

        await registry.removeProvider(args.accountId);
        await storage.deleteAccount(args.accountId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                accountId: args.accountId,
                email: credentials.email,
                provider: credentials.provider,
                message: 'Account removed successfully',
              }),
            },
          ],
        };
      } catch (error) {
        logger.error('auth_revoke failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Get Google auth flow instance (used by OAuth callback).
 */
export function getGoogleAuthFlow(): GoogleAuth {
  return getGoogleAuth();
}
