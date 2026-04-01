/**
 * Postgres client + credential CRUD.
 * Encryption handled in Node.js (AES-256-GCM), stored as base64 TEXT.
 * Connects to local Postgres via DATABASE_URL env var.
 *
 * Connects to local Postgres in Docker Compose.
 */

import pg from 'pg';
const { Pool } = pg;
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { Credentials } from '../auth/types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // NIST-recommended 96 bits for GCM

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
    });
    pool.on('error', (err) => {
      logger.error('Postgres pool error', err);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

function getKey(): Buffer {
  return Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY, 'hex');
}

/**
 * Encrypt arbitrary string data. Returns base64-encoded ciphertext.
 * Format: iv (12) + authTag (16) + ciphertext
 */
export function encryptData(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt base64-encoded ciphertext back to string.
 */
export function decryptData(encoded: string): string {
  const key = getKey();
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = data.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function encryptCredentials(credentials: Credentials): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptCredentials(data: Buffer): Credentials {
  const key = getKey();
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = data.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'), (key, value) => {
    if (key === 'createdAt' || key === 'updatedAt' || key === 'expiresAt') {
      return new Date(value as string);
    }
    return value;
  });
}

// --- Account CRUD ---

export async function saveAccount(credentials: Credentials): Promise<void> {
  const encrypted = encryptCredentials(credentials);
  const db = getPool();

  await db.query(
    `INSERT INTO accounts (id, name, provider, email, encrypted_credentials, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       encrypted_credentials = EXCLUDED.encrypted_credentials,
       updated_at = NOW()`,
    [
      credentials.accountId,
      credentials.accountName,
      credentials.provider,
      credentials.email,
      encrypted.toString('base64'),
    ]
  );

  logger.info('Saved account credentials', {
    accountId: credentials.accountId,
    provider: credentials.provider,
  });
}

export async function getAccount(accountId: string): Promise<Credentials | null> {
  const db = getPool();
  const result = await db.query(
    'SELECT encrypted_credentials FROM accounts WHERE id = $1',
    [accountId]
  );

  if (result.rows.length === 0) return null;

  const buffer = Buffer.from(result.rows[0].encrypted_credentials, 'base64');
  return decryptCredentials(buffer);
}

export async function listAccounts(): Promise<
  { id: string; name: string; provider: string; email: string }[]
> {
  const db = getPool();
  const result = await db.query('SELECT id, name, provider, email FROM accounts');
  return result.rows;
}

export async function deleteAccount(accountId: string): Promise<boolean> {
  const db = getPool();
  const result = await db.query('DELETE FROM accounts WHERE id = $1', [accountId]);
  return (result.rowCount ?? 0) > 0;
}

export async function hasAccount(accountId: string): Promise<boolean> {
  const db = getPool();
  const result = await db.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
  return result.rows.length > 0;
}

