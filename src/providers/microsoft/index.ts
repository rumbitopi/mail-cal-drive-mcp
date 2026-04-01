/**
 * Microsoft 365 provider combining mail, calendar, and drive.
 */

import { Client } from '@microsoft/microsoft-graph-client';
import { BaseProvider } from '../base.js';
import { Capability } from '../types.js';
import { MicrosoftCredentials } from '../../auth/types.js';
import { logger } from '../../logger.js';
import { getMicrosoftAuth, MicrosoftAuth } from './auth.js';
import { MicrosoftMailProvider } from './mail.js';
import { MicrosoftCalendarProvider } from './calendar.js';
import { MicrosoftDriveProvider } from './drive.js';

/**
 * Microsoft 365 provider with mail, calendar, and OneDrive support.
 */
export class MicrosoftProvider extends BaseProvider {
  readonly accountId: string;
  readonly providerType = 'microsoft' as const;
  readonly capabilities: Capability[] = ['mail', 'calendar', 'drive'];

  private credentials: MicrosoftCredentials;
  private auth: MicrosoftAuth;
  private client: Client | null = null;

  constructor(credentials: MicrosoftCredentials) {
    super();
    this.accountId = credentials.accountId;
    this.credentials = credentials;
    this.auth = getMicrosoftAuth();
  }

  /**
   * Initialize the Graph client and sub-providers.
   */
  async initialize(): Promise<void> {
    // Get valid access token
    const accessToken = await this.auth.getValidToken(this.credentials);

    // Create Graph client with auth provider
    this.client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });

    // Initialize sub-providers
    this.mail = new MicrosoftMailProvider(this.accountId, this.client);
    this.calendar = new MicrosoftCalendarProvider(this.accountId, this.client);
    this.drive = new MicrosoftDriveProvider(this.accountId, this.client);

    logger.info('Microsoft provider initialized', {
      accountId: this.accountId,
      email: this.credentials.email,
    });
  }

  async isConnected(): Promise<boolean> {
    if (!this.client) {
      try {
        await this.initialize();
      } catch {
        return false;
      }
    }

    try {
      // Test connection with a simple API call
      await this.client!.api('/me').select('id').get();
      return true;
    } catch {
      return false;
    }
  }

  async refreshAuth(): Promise<void> {
    const newToken = await this.auth.getValidToken(this.credentials);

    // Recreate client with new token
    this.client = Client.init({
      authProvider: (done) => {
        done(null, newToken);
      },
    });

    // Reinitialize sub-providers with new client
    this.mail = new MicrosoftMailProvider(this.accountId, this.client);
    this.calendar = new MicrosoftCalendarProvider(this.accountId, this.client);
    this.drive = new MicrosoftDriveProvider(this.accountId, this.client);

    logger.info('Microsoft provider auth refreshed', { accountId: this.accountId });
  }

  async disconnect(): Promise<void> {
    this.client = null;
    // Use delete to properly remove optional properties
    delete this.mail;
    delete this.calendar;
    delete this.drive;

    logger.info('Microsoft provider disconnected', { accountId: this.accountId });
  }
}

// Re-export auth and sub-providers
export { getMicrosoftAuth, MicrosoftAuth } from './auth.js';
export { MicrosoftMailProvider } from './mail.js';
export { MicrosoftCalendarProvider } from './calendar.js';
export { MicrosoftDriveProvider } from './drive.js';
