/**
 * Google OAuth authentication.
 */

import { google, Auth } from 'googleapis';
import { config } from '../../config.js';
import { logger, logAuth } from '../../logger.js';
import { GoogleCredentials } from '../../auth/types.js';
import { getCredentialStorage } from '../../auth/storage.js';
import { AuthenticationError } from '../types.js';

// Google API scopes
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * Google authentication manager.
 * Handles OAuth callback flow and token refresh.
 */
export class GoogleAuth {
  private oauth2Client: Auth.OAuth2Client;

  constructor() {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
    }

    this.oauth2Client = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_REDIRECT_URI
    );
  }

  /**
   * Generate authorization URL for OAuth flow.
   */
  getAuthUrl(accountName?: string, state?: string): string {
    const stateParam = state || `google-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state: stateParam,
      prompt: 'consent', // Force consent to get refresh token
    });

    logAuth('auth-url-generated', 'google', { accountName });
    return url;
  }

  /**
   * Handle OAuth callback - exchange code for tokens and create credentials.
   */
  async handleCallback(
    code: string,
    state: string
  ): Promise<GoogleCredentials | null> {
    try {
      const result = await this.exchangeCode(code);

      // Extract account name from state if possible
      const accountName = state.split('-')[0] === 'google' ? 'Google Account' : state;

      const credentials: GoogleCredentials = {
        accountId: `google-${Date.now()}`,
        accountName,
        email: result.email,
        provider: 'google',
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return credentials;
    } catch (error) {
      logger.error('OAuth callback handling failed', error);
      return null;
    }
  }

  /**
   * Exchange authorization code for tokens.
   */
  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    email: string;
  }> {
    logAuth('exchange-code', 'google');

    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token) {
        throw new AuthenticationError('google', 'No access token received');
      }

      this.oauth2Client.setCredentials(tokens);

      // Get user email
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const { data } = await oauth2.userinfo.get();

      if (!data.email) {
        throw new AuthenticationError('google', 'Could not get user email');
      }

      logAuth('exchange-code-complete', 'google', { email: data.email });

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : new Date(Date.now() + 3600 * 1000),
        email: data.email,
      };
    } catch (error) {
      logger.error('Code exchange failed', error);
      throw new AuthenticationError(
        'google',
        error instanceof Error ? error.message : 'Code exchange failed'
      );
    }
  }

  /**
   * Refresh access token.
   */
  async refreshToken(refreshToken: string): Promise<string> {
    logAuth('refresh-token', 'google');

    try {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new AuthenticationError('google', 'No access token received');
      }

      logAuth('token-refreshed', 'google');
      return credentials.access_token;
    } catch (error) {
      logger.error('Token refresh failed', error);
      throw new AuthenticationError(
        'google',
        error instanceof Error ? error.message : 'Token refresh failed'
      );
    }
  }

  /**
   * Get a valid access token, refreshing if needed.
   */
  async getValidToken(credentials: GoogleCredentials): Promise<string> {
    const now = Date.now();
    const expiresAt = credentials.expiresAt.getTime();
    const buffer = 5 * 60 * 1000; // 5 minutes

    if (expiresAt > now + buffer) {
      return credentials.accessToken;
    }

    // Token expired or expiring soon, refresh it
    logger.debug('Token expiring, refreshing', {
      accountId: credentials.accountId,
      expiresAt: credentials.expiresAt,
    });

    const newToken = await this.refreshToken(credentials.refreshToken);

    // Update stored credentials
    const storage = getCredentialStorage();
    const updatedCredentials: GoogleCredentials = {
      ...credentials,
      accessToken: newToken,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      updatedAt: new Date(),
    };
    await storage.saveAccount(updatedCredentials);

    return newToken;
  }

  /**
   * Get an OAuth2 client configured with credentials.
   */
  getOAuth2Client(credentials: GoogleCredentials): Auth.OAuth2Client {
    const client = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_REDIRECT_URI
    );

    client.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
    });

    return client;
  }

  /**
   * Revoke tokens (sign out).
   */
  async revokeToken(token: string): Promise<void> {
    logAuth('revoke-token', 'google');

    try {
      await this.oauth2Client.revokeToken(token);
    } catch (error) {
      logger.error('Token revocation failed', error);
    }
  }
}

// Singleton instance
let authInstance: GoogleAuth | null = null;

export function getGoogleAuth(): GoogleAuth {
  if (!authInstance) {
    authInstance = new GoogleAuth();
  }
  return authInstance;
}
