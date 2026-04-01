/**
 * Google Workspace provider combining Gmail, Calendar, and Drive.
 */

import { Auth } from 'googleapis';
import { BaseProvider } from '../base.js';
import { Capability } from '../types.js';
import { GoogleCredentials } from '../../auth/types.js';
import { logger } from '../../logger.js';
import { getGoogleAuth, GoogleAuth } from './auth.js';
import { GoogleMailProvider } from './mail.js';
import { GoogleCalendarProvider } from './calendar.js';
import { GoogleDriveProvider } from './drive.js';

/**
 * Google Workspace provider with Gmail, Calendar, and Drive support.
 */
export class GoogleProvider extends BaseProvider {
  readonly accountId: string;
  readonly providerType = 'google' as const;
  readonly capabilities: Capability[] = ['mail', 'calendar', 'drive'];

  private credentials: GoogleCredentials;
  private auth: GoogleAuth;
  private oauth2Client: Auth.OAuth2Client | null = null;

  constructor(credentials: GoogleCredentials) {
    super();
    this.accountId = credentials.accountId;
    this.credentials = credentials;
    this.auth = getGoogleAuth();
  }

  /**
   * Initialize the OAuth client and sub-providers.
   */
  async initialize(): Promise<void> {
    // Get valid access token (may refresh if needed)
    await this.auth.getValidToken(this.credentials);

    // Create OAuth client with credentials
    this.oauth2Client = this.auth.getOAuth2Client(this.credentials);

    // Initialize sub-providers
    this.mail = new GoogleMailProvider(this.accountId, this.oauth2Client);
    this.calendar = new GoogleCalendarProvider(this.accountId, this.oauth2Client);
    this.drive = new GoogleDriveProvider(this.accountId, this.oauth2Client);

    logger.info('Google provider initialized', {
      accountId: this.accountId,
      email: this.credentials.email,
    });
  }

  async isConnected(): Promise<boolean> {
    if (!this.oauth2Client) {
      try {
        await this.initialize();
      } catch {
        return false;
      }
    }

    try {
      // Test connection with a simple API call
      const gmail = await import('googleapis').then((m) =>
        m.google.gmail({ version: 'v1', auth: this.oauth2Client! })
      );
      await gmail.users.getProfile({ userId: 'me' });
      return true;
    } catch {
      return false;
    }
  }

  async refreshAuth(): Promise<void> {
    await this.auth.getValidToken(this.credentials);

    // Recreate OAuth client
    this.oauth2Client = this.auth.getOAuth2Client(this.credentials);

    // Reinitialize sub-providers
    this.mail = new GoogleMailProvider(this.accountId, this.oauth2Client);
    this.calendar = new GoogleCalendarProvider(this.accountId, this.oauth2Client);
    this.drive = new GoogleDriveProvider(this.accountId, this.oauth2Client);

    logger.info('Google provider auth refreshed', { accountId: this.accountId });
  }

  async disconnect(): Promise<void> {
    this.oauth2Client = null;
    delete this.mail;
    delete this.calendar;
    delete this.drive;

    logger.info('Google provider disconnected', { accountId: this.accountId });
  }
}

// Re-export auth and sub-providers
export { getGoogleAuth, GoogleAuth } from './auth.js';
export { GoogleMailProvider } from './mail.js';
export { GoogleCalendarProvider } from './calendar.js';
export { GoogleDriveProvider } from './drive.js';
