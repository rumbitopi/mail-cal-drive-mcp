/**
 * Pending auth flow storage backed by Postgres.
 * Flow data encrypted at rest with AES-256-GCM.
 */

import { getPool, encryptData, decryptData } from './postgres.js';
import { logger } from '../logger.js';

export interface PendingFlowRow {
  id: string;
  provider: string;
  account_name: string;
  state: string | null;
  flow_data: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

function encryptFlowData(flowData: Record<string, unknown>): string {
  return encryptData(JSON.stringify(flowData));
}

function decryptFlowData(encrypted: string): Record<string, unknown> {
  return JSON.parse(decryptData(encrypted));
}

function rowToFlow(row: Record<string, unknown>): PendingFlowRow {
  return {
    ...row,
    flow_data: decryptFlowData(row.flow_data as string),
  } as PendingFlowRow;
}

export async function createPendingFlow(
  id: string,
  provider: string,
  accountName: string,
  flowData: Record<string, unknown>,
  state?: string
): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO pending_auth_flows (id, provider, account_name, state, flow_data)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, provider, accountName, state ?? null, encryptFlowData(flowData)]
  );
  logger.debug('Created pending auth flow', { id, provider });
}

export async function getPendingFlow(id: string): Promise<PendingFlowRow | null> {
  const db = getPool();
  const result = await db.query(
    'SELECT * FROM pending_auth_flows WHERE id = $1 AND expires_at > NOW()',
    [id]
  );
  if (result.rows.length === 0) return null;
  return rowToFlow(result.rows[0]);
}

export async function findPendingFlowByState(state: string): Promise<PendingFlowRow | null> {
  const db = getPool();
  const result = await db.query(
    'SELECT * FROM pending_auth_flows WHERE state = $1 AND expires_at > NOW()',
    [state]
  );
  if (result.rows.length === 0) return null;
  return rowToFlow(result.rows[0]);
}

export async function updatePendingFlow(
  id: string,
  flowData: Record<string, unknown>
): Promise<void> {
  const db = getPool();
  await db.query(
    'UPDATE pending_auth_flows SET flow_data = $1 WHERE id = $2',
    [encryptFlowData(flowData), id]
  );
}

export async function deletePendingFlow(id: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM pending_auth_flows WHERE id = $1', [id]);
}
