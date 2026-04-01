/**
 * Provider registry and factory.
 * Creates providers on demand from Postgres credentials.
 */

import { CredentialStorage, getCredentialStorage } from '../auth/storage.js';
import {
  Credentials,
  MicrosoftCredentials,
  GoogleCredentials,
  ImapCredentials,
} from '../auth/types.js';
import { logger } from '../logger.js';
import { Provider } from './base.js';
import { Account, Capability } from './types.js';
import { MicrosoftProvider } from './microsoft/index.js';
import { GoogleProvider } from './google/index.js';
import { ImapProvider } from './imap/index.js';

/**
 * Provider registry creates providers on demand from Postgres credentials.
 */
export class ProviderRegistry {
  private storage: CredentialStorage;

  constructor(storage?: CredentialStorage) {
    this.storage = storage ?? getCredentialStorage();
  }

  /**
   * Get a provider by account ID.
   * Creates a fresh provider from Postgres credentials.
   */
  async getProvider(accountId: string): Promise<Provider | null> {
    const credentials = await this.storage.getAccount(accountId);
    if (!credentials) {
      logger.warn('Account not found', { accountId });
      return null;
    }

    try {
      const provider = await this.createProvider(credentials);
      await provider.initialize();
      return provider;
    } catch (error) {
      logger.error('Failed to create provider', error, {
        accountId,
        provider: credentials.provider,
      });
      return null;
    }
  }

  /**
   * Create a provider instance from credentials.
   */
  private async createProvider(credentials: Credentials): Promise<Provider> {
    switch (credentials.provider) {
      case 'microsoft':
        return new MicrosoftProvider(credentials as MicrosoftCredentials);

      case 'google':
        return new GoogleProvider(credentials as GoogleCredentials);

      case 'imap':
        return new ImapProvider(credentials as ImapCredentials);
    }

    // TypeScript exhaustiveness check
    const _exhaustive: never = credentials;
    throw new Error('Unknown provider type');
  }

  /**
   * Remove a provider — no-op in serverless (no cached instances).
   */
  async removeProvider(_accountId: string): Promise<void> {
    // Nothing to clean up in serverless
  }

  /**
   * List all accounts with their connection status.
   */
  async listAccounts(): Promise<Account[]> {
    return this.storage.listAccounts();
  }

  /**
   * Get providers that support a specific capability.
   */
  async getProvidersWithCapability(capability: Capability): Promise<Provider[]> {
    const accounts = await this.storage.listAccounts();
    const providers: Provider[] = [];

    for (const account of accounts) {
      if (account.capabilities.includes(capability)) {
        const provider = await this.getProvider(account.id);
        if (provider) {
          providers.push(provider);
        }
      }
    }

    return providers;
  }

  /**
   * Get credential storage for auth operations.
   */
  getStorage(): CredentialStorage {
    return this.storage;
  }
}

// Singleton instance
let registryInstance: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!registryInstance) {
    registryInstance = new ProviderRegistry();
  }
  return registryInstance;
}

// Re-export types for convenience
export type { Provider as ProviderType } from './types.js';
export type {
  Account,
  Capability,
  EmailFolder,
  EmailMessage,
  EmailSearchCriteria,
  BulkMailAction,
  BulkMailResult,
  Calendar,
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  FreeBusySlot,
  ConflictResult,
  DriveFile,
  FileSearchCriteria,
  FileListResult,
  ShareInput,
  SharedUser,
  ShareLink,
  StorageQuota,
} from './types.js';
export {
  ProviderError,
  AuthenticationError,
  RateLimitError,
  NotFoundError,
  PermissionError,
} from './types.js';
export type { Provider, IMailProvider, ICalendarProvider, IDriveProvider } from './base.js';
export { BaseProvider } from './base.js';
