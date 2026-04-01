/**
 * One-time migration script.
 * Reads local credentials.enc, decrypts with old master key,
 * re-encrypts with new key, writes to Postgres.
 *
 * Usage:
 *   DATABASE_URL=... CREDENTIAL_ENCRYPTION_KEY=... \
 *   npm run migrate [credentials-path] [master-key-path]
 */

import { readFileSync, existsSync } from 'fs';
import { createDecipheriv, scryptSync, createCipheriv, randomBytes } from 'crypto';
import pg from 'pg';
const { Pool } = pg;
import type { Credentials } from '../auth/types.js';

// Old encryption params (from original storage.ts)
const OLD_ALGORITHM = 'aes-256-gcm';
const OLD_SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const OLD_KEY_LENGTH = 32;

// New encryption params
const NEW_ALGORITHM = 'aes-256-gcm';
const NEW_IV_LENGTH = 16;

interface OldEncryptedData {
  encryptedData: string;
  iv: string;
  salt: string;
  authTag: string;
}

interface OldCredentialStore {
  version: number;
  accounts: Record<string, OldEncryptedData>;
}

function decryptOld(encrypted: OldEncryptedData, masterKey: Buffer): Credentials {
  const salt = Buffer.from(encrypted.salt, 'base64');
  const key = scryptSync(masterKey, salt, OLD_KEY_LENGTH, OLD_SCRYPT_PARAMS);
  const iv = Buffer.from(encrypted.iv, 'base64');
  const decipher = createDecipheriv(OLD_ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));

  let decrypted = decipher.update(encrypted.encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted, (key, value) => {
    if (key === 'createdAt' || key === 'updatedAt' || key === 'expiresAt') {
      return new Date(value as string);
    }
    return value;
  });
}

function encryptNew(credentials: Credentials, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  const iv = randomBytes(NEW_IV_LENGTH);
  const cipher = createCipheriv(NEW_ALGORITHM, key, iv);

  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

async function migrate() {
  const credPath = process.argv[2] || './data/credentials.enc';
  const masterKeyPath = process.argv[3] || './secrets/master-key.txt';

  if (!existsSync(credPath)) {
    console.error(`Credentials file not found: ${credPath}`);
    process.exit(1);
  }

  if (!existsSync(masterKeyPath)) {
    console.error(`Master key file not found: ${masterKeyPath}`);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!databaseUrl || !encryptionKey) {
    console.error('Required env vars: DATABASE_URL, CREDENTIAL_ENCRYPTION_KEY');
    process.exit(1);
  }

  const masterKey = Buffer.from(readFileSync(masterKeyPath, 'utf-8').trim(), 'hex');
  const store: OldCredentialStore = JSON.parse(readFileSync(credPath, 'utf-8'));

  const pool = new Pool({ connectionString: databaseUrl });

  const accountIds = Object.keys(store.accounts);
  console.log(`Found ${accountIds.length} accounts to migrate`);

  for (const accountId of accountIds) {
    const encrypted = store.accounts[accountId];
    if (!encrypted) continue;

    try {
      const credentials = decryptOld(encrypted, masterKey);
      const newEncrypted = encryptNew(credentials, encryptionKey);

      await pool.query(
        `INSERT INTO accounts (id, name, provider, email, encrypted_credentials, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE SET
           encrypted_credentials = EXCLUDED.encrypted_credentials, updated_at = NOW()`,
        [credentials.accountId, credentials.accountName, credentials.provider, credentials.email, newEncrypted]
      );

      console.log(`  Migrated: ${credentials.email} (${credentials.provider})`);
    } catch (err) {
      console.error(`  FAILED: ${accountId}`, err);
    }
  }

  // Migrate MSAL cache if it exists
  const msalPath = credPath.replace('.enc', '-msal.json');
  if (existsSync(msalPath)) {
    try {
      const msalEncrypted: OldEncryptedData = JSON.parse(readFileSync(msalPath, 'utf-8'));
      const salt = Buffer.from(msalEncrypted.salt, 'base64');
      const key = scryptSync(masterKey, salt, OLD_KEY_LENGTH, OLD_SCRYPT_PARAMS);
      const iv = Buffer.from(msalEncrypted.iv, 'base64');
      const decipher = createDecipheriv(OLD_ALGORITHM, key, iv);
      decipher.setAuthTag(Buffer.from(msalEncrypted.authTag, 'base64'));
      let decrypted = decipher.update(msalEncrypted.encryptedData, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      const { cache } = JSON.parse(decrypted);

      await pool.query(
        `INSERT INTO msal_cache (id, cache_data, updated_at)
         VALUES ('default', $1, NOW())
         ON CONFLICT (id) DO UPDATE SET cache_data = EXCLUDED.cache_data, updated_at = NOW()`,
        [cache]
      );

      console.log('  Migrated MSAL cache');
    } catch (err) {
      console.error('  FAILED to migrate MSAL cache:', err);
    }
  }

  await pool.end();
  console.log('Migration complete!');
}

migrate().catch(console.error);
