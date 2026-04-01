/**
 * MSAL cache plugin backed by Postgres.
 * Cache data encrypted at rest with AES-256-GCM.
 */

import { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { getPool, encryptData, decryptData } from './postgres.js';
import { logger } from '../logger.js';

export function createPostgresCachePlugin(): ICachePlugin {
  return {
    beforeCacheAccess: async (context: TokenCacheContext): Promise<void> => {
      const db = getPool();
      const result = await db.query(
        "SELECT cache_data FROM msal_cache WHERE id = 'default'"
      );

      if (result.rows.length === 0) {
        logger.debug('No MSAL cache found in Postgres');
        return;
      }

      try {
        const decrypted = decryptData(result.rows[0].cache_data);
        context.tokenCache.deserialize(decrypted);
        logger.debug('Loaded MSAL cache from Postgres');
      } catch (err) {
        logger.error('Failed to decrypt MSAL cache', err);
      }
    },

    afterCacheAccess: async (context: TokenCacheContext): Promise<void> => {
      if (!context.cacheHasChanged) return;

      const db = getPool();
      const serialized = context.tokenCache.serialize();
      const encrypted = encryptData(serialized);

      await db.query(
        `INSERT INTO msal_cache (id, cache_data, updated_at)
         VALUES ('default', $1, NOW())
         ON CONFLICT (id) DO UPDATE SET
           cache_data = EXCLUDED.cache_data,
           updated_at = NOW()`,
        [encrypted]
      );

      logger.debug('Saved MSAL cache to Postgres');
    },
  };
}
