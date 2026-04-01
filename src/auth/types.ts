/**
 * Provider types supported by the MCP server
 */
export type Provider = 'microsoft' | 'google' | 'imap';

/**
 * Capabilities that a provider can support
 */
export type Capability = 'mail' | 'calendar' | 'drive';

/**
 * Base credential fields shared by all providers
 */
export interface BaseCredentials {
  accountId: string;
  accountName: string;
  email: string;
  provider: Provider;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Microsoft 365 OAuth credentials
 */
export interface MicrosoftCredentials extends BaseCredentials {
  provider: 'microsoft';
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  homeAccountId: string; // MSAL account identifier for silent token refresh
}

/**
 * Google OAuth credentials
 */
export interface GoogleCredentials extends BaseCredentials {
  provider: 'google';
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * IMAP direct credentials (email only, no OAuth)
 */
export interface ImapCredentials extends BaseCredentials {
  provider: 'imap';
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
}

/**
 * Union type for all credential types
 */
export type Credentials = MicrosoftCredentials | GoogleCredentials | ImapCredentials;

/**
 * Encrypted data format stored on disk
 */
export interface EncryptedData {
  encryptedData: string; // Base64 encoded ciphertext
  iv: string; // Base64 encoded initialization vector
  salt: string; // Base64 encoded salt for key derivation
  authTag: string; // Base64 encoded GCM authentication tag
}

/**
 * Credential store file format
 */
export interface CredentialStore {
  version: number;
  accounts: Record<string, EncryptedData>;
}

/**
 * Account summary (safe to expose, no secrets)
 */
export interface Account {
  id: string;
  name: string;
  provider: Provider;
  email: string;
  capabilities: Capability[];
  connected: boolean;
  lastSync?: Date;
}

/**
 * Provider capabilities mapping
 */
export const PROVIDER_CAPABILITIES: Record<Provider, readonly Capability[]> = {
  microsoft: ['mail', 'calendar', 'drive'] as const,
  google: ['mail', 'calendar', 'drive'] as const,
  imap: ['mail'] as const,
};

/**
 * Check if credentials have expired
 */
export function isExpired(credentials: Credentials): boolean {
  if (credentials.provider === 'imap') {
    return false; // IMAP credentials don't expire
  }
  return credentials.expiresAt.getTime() < Date.now();
}

/**
 * Check if credentials need refresh (within 5 minutes of expiry)
 */
export function needsRefresh(credentials: Credentials): boolean {
  if (credentials.provider === 'imap') {
    return false;
  }
  const fiveMinutes = 5 * 60 * 1000;
  return credentials.expiresAt.getTime() < Date.now() + fiveMinutes;
}
