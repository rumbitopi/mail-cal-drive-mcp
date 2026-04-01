/**
 * IMAP provider (mail only).
 */

import { BaseProvider } from '../base.js';
import { Capability } from '../types.js';
import { ImapCredentials } from '../../auth/types.js';
import { logger } from '../../logger.js';
import { ImapMailProvider } from './mail.js';

/**
 * IMAP provider with mail support only.
 */
export class ImapProvider extends BaseProvider {
  readonly accountId: string;
  readonly providerType = 'imap' as const;
  readonly capabilities: Capability[] = ['mail'];

  private credentials: ImapCredentials;
  private mailProvider: ImapMailProvider | null = null;

  constructor(credentials: ImapCredentials) {
    super();
    this.accountId = credentials.accountId;
    this.credentials = credentials;
  }

  /**
   * Initialize the IMAP mail provider.
   */
  async initialize(): Promise<void> {
    this.mailProvider = new ImapMailProvider(this.credentials);
    this.mail = this.mailProvider;

    logger.info('IMAP provider initialized', {
      accountId: this.accountId,
      host: this.credentials.host,
      email: this.credentials.email,
    });
  }

  async isConnected(): Promise<boolean> {
    if (!this.mailProvider) {
      try {
        await this.initialize();
      } catch {
        return false;
      }
    }

    try {
      // Test connection by listing folders
      await this.mailProvider!.listFolders();
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.mailProvider) {
      await this.mailProvider.disconnect();
      this.mailProvider = null;
    }
    delete this.mail;

    logger.info('IMAP provider disconnected', { accountId: this.accountId });
  }
}

// Re-export mail provider
export { ImapMailProvider } from './mail.js';
