-- Workspace MCP Server - Postgres Schema
-- All sensitive data encrypted with AES-256-GCM in Node.js before storage

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('microsoft', 'google', 'imap')),
  email TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accounts_provider ON accounts(provider);
CREATE UNIQUE INDEX idx_accounts_provider_email ON accounts(provider, email);

-- MSAL token cache (encrypted, single row)
CREATE TABLE msal_cache (
  id TEXT PRIMARY KEY DEFAULT 'default',
  cache_data TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pending OAuth/device code flows (encrypted, 10 min TTL)
CREATE TABLE pending_auth_flows (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_name TEXT NOT NULL,
  state TEXT,
  flow_data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX idx_pending_auth_expires ON pending_auth_flows(expires_at);
CREATE INDEX idx_pending_auth_state ON pending_auth_flows(state);

-- Cleanup expired pending flows
CREATE OR REPLACE FUNCTION cleanup_expired() RETURNS void AS $$
BEGIN
  DELETE FROM pending_auth_flows WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
