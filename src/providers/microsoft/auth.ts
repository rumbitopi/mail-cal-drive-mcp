/**
 * Microsoft 365 Authentication.
 * - Device code flow via direct HTTP (serverless-compatible, no MSAL long-poll)
 * - Token refresh via MSAL acquireTokenSilent (Postgres-backed cache)
 */

import {
  PublicClientApplication,
  AccountInfo,
} from '@azure/msal-node';
import { config } from '../../config.js';
import { logger, logAuth } from '../../logger.js';
import { MicrosoftCredentials } from '../../auth/types.js';
import { getCredentialStorage } from '../../auth/storage.js';
import { AuthenticationError } from '../types.js';
import { createPostgresCachePlugin } from '../../storage/msal-cache.js';

// Microsoft Graph API scopes
const SCOPES = [
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.ReadWrite',
  'Calendars.Read.Shared',
  'Files.ReadWrite',
  'Files.ReadWrite.All',
  'User.Read',
  'offline_access',
];

function getAuthority(): string {
  return `https://login.microsoftonline.com/${config.MS_TENANT_ID || 'common'}`;
}

function getClientId(): string {
  if (!config.MS_CLIENT_ID) {
    throw new Error('MS_CLIENT_ID is required for Microsoft provider');
  }
  return config.MS_CLIENT_ID;
}

// MSAL configuration with Postgres-backed cache
function createMsalConfig() {
  return {
    auth: {
      clientId: getClientId(),
      authority: getAuthority(),
    },
    cache: {
      cachePlugin: createPostgresCachePlugin(),
    },
    system: {
      loggerOptions: {
        loggerCallback: (level: number, message: string) => {
          if (level <= 1) {
            logger.debug('MSAL', { level, message });
          }
        },
        piiLoggingEnabled: false,
        logLevel: 2,
      },
    },
  };
}

// --- Device Code Flow via Direct HTTP (serverless-compatible) ---

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

interface TokenErrorResponse {
  error: string;
  error_description: string;
}

/**
 * Request a device code from Microsoft (direct HTTP, non-blocking).
 * Returns the device code + user code for display.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  logAuth('request-device-code', 'microsoft');

  const response = await fetch(`${getAuthority()}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      scope: SCOPES.join(' '),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new AuthenticationError('microsoft', `Device code request failed: ${error}`);
  }

  return (await response.json()) as DeviceCodeResponse;
}

/**
 * Poll Microsoft's token endpoint to check if user completed device code auth.
 * Returns tokens on success, null if still pending, throws on error/expiry.
 */
export async function pollDeviceCodeToken(
  deviceCode: string
): Promise<TokenResponse | null> {
  logAuth('poll-device-code', 'microsoft');

  const response = await fetch(`${getAuthority()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    }),
  });

  const body = await response.json();

  if (response.ok) {
    return body as TokenResponse;
  }

  const errorBody = body as TokenErrorResponse;

  if (errorBody.error === 'authorization_pending') {
    return null; // User hasn't completed auth yet
  }

  if (errorBody.error === 'slow_down') {
    return null; // Polling too fast, treat same as pending
  }

  if (errorBody.error === 'expired_token') {
    throw new AuthenticationError('microsoft', 'Device code expired. Start a new auth flow.');
  }

  throw new AuthenticationError(
    'microsoft',
    `Token request failed: ${errorBody.error_description || errorBody.error}`
  );
}

/**
 * Decode a JWT to extract claims (no verification — just parsing).
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return {};
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

/**
 * After device code token exchange succeeds, seed the MSAL cache manually
 * so that acquireTokenSilent works for subsequent token refreshes.
 */
export async function seedMsalCacheFromTokens(
  accessToken: string,
  refreshToken: string,
  idToken: string | undefined,
  expiresIn: number
): Promise<{ email: string; homeAccountId: string }> {
  // Extract user info from access token or id token
  const tokenPayload = decodeJwtPayload(idToken || accessToken);
  const email =
    (tokenPayload.preferred_username as string) ||
    (tokenPayload.upn as string) ||
    (tokenPayload.email as string) ||
    '';
  const oid = (tokenPayload.oid as string) || '';
  const tid = (tokenPayload.tid as string) || config.MS_TENANT_ID || 'common';
  const homeAccountId = `${oid}.${tid}`;

  // Save tokens to MSAL cache via the Postgres-backed cache plugin
  // We create a PCA instance, which loads the cache, then we can use it for refresh
  const pca = new PublicClientApplication(createMsalConfig());

  // Force cache to be loaded/saved by doing a cache operation
  const cache = pca.getTokenCache();

  // We need to manually add the account to the MSAL cache
  // The simplest way is to serialize the cache format MSAL expects
  const storage = getCredentialStorage();
  const existingCache = await storage.loadMsalCache();
  const cacheData = existingCache ? JSON.parse(existingCache) : {};

  // Build MSAL cache entries
  const accountKey = `${homeAccountId}-login.microsoftonline.com-${tid}`;
  const now = Math.floor(Date.now() / 1000);

  if (!cacheData.Account) cacheData.Account = {};
  cacheData.Account[accountKey] = {
    home_account_id: homeAccountId,
    environment: 'login.microsoftonline.com',
    realm: tid,
    local_account_id: oid,
    username: email,
    authority_type: 'MSSTS',
  };

  if (!cacheData.RefreshToken) cacheData.RefreshToken = {};
  cacheData.RefreshToken[`${homeAccountId}-login.microsoftonline.com-refreshtoken-${getClientId()}--${SCOPES.join(' ')}`] = {
    home_account_id: homeAccountId,
    environment: 'login.microsoftonline.com',
    credential_type: 'RefreshToken',
    client_id: getClientId(),
    secret: refreshToken,
    target: SCOPES.join(' '),
  };

  if (!cacheData.AccessToken) cacheData.AccessToken = {};
  cacheData.AccessToken[`${homeAccountId}-login.microsoftonline.com-accesstoken-${getClientId()}-${tid}-${SCOPES.join(' ')}`] = {
    home_account_id: homeAccountId,
    environment: 'login.microsoftonline.com',
    credential_type: 'AccessToken',
    client_id: getClientId(),
    secret: accessToken,
    realm: tid,
    target: SCOPES.join(' '),
    cached_at: String(now),
    expires_on: String(now + expiresIn),
    extended_expires_on: String(now + expiresIn),
  };

  if (idToken && !cacheData.IdToken) cacheData.IdToken = {};
  if (idToken) {
    cacheData.IdToken[`${homeAccountId}-login.microsoftonline.com-idtoken-${getClientId()}-${tid}-`] = {
      home_account_id: homeAccountId,
      environment: 'login.microsoftonline.com',
      credential_type: 'IdToken',
      client_id: getClientId(),
      secret: idToken,
      realm: tid,
    };
  }

  await storage.saveMsalCache(JSON.stringify(cacheData));

  logAuth('msal-cache-seeded', 'microsoft', { email, homeAccountId });
  return { email, homeAccountId };
}

// --- MSAL-based Token Refresh (uses Postgres-backed cache) ---

/**
 * Microsoft authentication manager.
 * Uses MSAL for token refresh (cache backed by Postgres).
 */
export class MicrosoftAuth {
  private pca: PublicClientApplication;

  constructor() {
    this.pca = new PublicClientApplication(createMsalConfig());
  }

  /**
   * Refresh access token using cached account.
   */
  async refreshToken(homeAccountId: string): Promise<string> {
    logAuth('refresh-token', 'microsoft');

    try {
      const cache = this.pca.getTokenCache();
      const accounts = await cache.getAllAccounts();
      const account = accounts.find((a: AccountInfo) => a.homeAccountId === homeAccountId);

      if (!account) {
        throw new AuthenticationError('microsoft', 'Account not found in cache');
      }

      const result = await this.pca.acquireTokenSilent({
        scopes: SCOPES,
        account,
      });

      if (!result) {
        throw new AuthenticationError('microsoft', 'Failed to refresh token');
      }

      logAuth('token-refreshed', 'microsoft');
      return result.accessToken;
    } catch (error) {
      logger.error('Token refresh failed', error);
      throw new AuthenticationError(
        'microsoft',
        error instanceof Error ? error.message : 'Token refresh failed'
      );
    }
  }

  /**
   * Get a valid access token, refreshing if needed.
   */
  async getValidToken(credentials: MicrosoftCredentials): Promise<string> {
    const now = Date.now();
    const expiresAt = credentials.expiresAt.getTime();
    const buffer = 5 * 60 * 1000;

    if (expiresAt > now + buffer) {
      return credentials.accessToken;
    }

    logger.debug('Token expiring, refreshing', {
      accountId: credentials.accountId,
      expiresAt: credentials.expiresAt,
    });

    const newToken = await this.refreshToken(credentials.homeAccountId);

    const storage = getCredentialStorage();
    const updatedCredentials: MicrosoftCredentials = {
      ...credentials,
      accessToken: newToken,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      updatedAt: new Date(),
    };
    await storage.saveAccount(updatedCredentials);

    return newToken;
  }

  /**
   * Check if authentication is valid.
   */
  async isAuthenticated(homeAccountId: string): Promise<boolean> {
    try {
      const cache = this.pca.getTokenCache();
      const accounts = await cache.getAllAccounts();
      return accounts.some((a: AccountInfo) => a.homeAccountId === homeAccountId);
    } catch {
      return false;
    }
  }

  /**
   * Remove account from cache (sign out).
   */
  async signOut(homeAccountId: string): Promise<void> {
    logAuth('sign-out', 'microsoft');

    try {
      const cache = this.pca.getTokenCache();
      const accounts = await cache.getAllAccounts();
      const account = accounts.find((a: AccountInfo) => a.homeAccountId === homeAccountId);

      if (account) {
        await cache.removeAccount(account);
      }
    } catch (error) {
      logger.error('Sign out failed', error);
    }
  }
}

// Singleton instance
let authInstance: MicrosoftAuth | null = null;

export function getMicrosoftAuth(): MicrosoftAuth {
  if (!authInstance) {
    authInstance = new MicrosoftAuth();
  }
  return authInstance;
}
