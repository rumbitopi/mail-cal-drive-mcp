/**
 * Credential storage backed by Postgres.
 * Credentials encrypted with AES-256-GCM in Node.js before storage.
 */

import { Credentials, Account, PROVIDER_CAPABILITIES } from './types.js';
import {
  saveAccount as dbSaveAccount,
  getAccount as dbGetAccount,
  listAccounts as dbListAccounts,
  deleteAccount as dbDeleteAccount,
  hasAccount as dbHasAccount,
  getPool,
  encryptData,
  decryptData,
} from '../storage/postgres.js';
import { logger } from '../logger.js';

export class CredentialStorage {
  async saveAccount(credentials: Credentials): Promise<void> {
    await dbSaveAccount(credentials);
  }

  async getAccount(accountId: string): Promise<Credentials | null> {
    return dbGetAccount(accountId);
  }

  async listAccounts(): Promise<Account[]> {
    const rows = await dbListAccounts();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider as Credentials['provider'],
      email: row.email,
      capabilities: [...PROVIDER_CAPABILITIES[row.provider as Credentials['provider']]],
      connected: true,
    }));
  }

  async deleteAccount(accountId: string): Promise<boolean> {
    return dbDeleteAccount(accountId);
  }

  hasAccount(accountId: string): Promise<boolean> {
    return dbHasAccount(accountId);
  }

  async getAccountIds(): Promise<string[]> {
    const rows = await dbListAccounts();
    return rows.map((r) => r.id);
  }

  async saveMsalCache(cache: string): Promise<void> {
    const db = getPool();
    try {
      const encrypted = encryptData(cache);
      await db.query(
        `INSERT INTO msal_cache (id, cache_data, updated_at)
         VALUES ('default', $1, NOW())
         ON CONFLICT (id) DO UPDATE SET cache_data = EXCLUDED.cache_data, updated_at = NOW()`,
        [encrypted]
      );
    } catch (error) {
      logger.error('Failed to save MSAL cache', error);
    }
  }

  async loadMsalCache(): Promise<string | null> {
    const db = getPool();
    try {
      const result = await db.query("SELECT cache_data FROM msal_cache WHERE id = 'default'");
      if (result.rows.length === 0) return null;
      return decryptData(result.rows[0].cache_data);
    } catch (error) {
      logger.error('Failed to load MSAL cache', error);
      return null;
    }
  }
}

let storageInstance: CredentialStorage | null = null;

export function getCredentialStorage(): CredentialStorage {
  if (!storageInstance) {
    storageInstance = new CredentialStorage();
  }
  return storageInstance;
}

// Backward-compat alias
export { CredentialStorage as SecureCredentialStorage };
