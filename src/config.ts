import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

// Load .env file
dotenvConfig();

const ConfigSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MCP_PORT: z.coerce.number().min(1).max(65535).default(3100),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  MAX_UPLOAD_SIZE: z.string().default('10mb'),

  // Database
  DATABASE_URL: z.string().min(1),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'Must be 64 hex chars (32 bytes)'),

  // Auth
  API_KEY: z.string().min(32),

  // CORS
  CORS_ORIGINS: z.string().optional(),

  // Microsoft 365
  MS_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  MS_CLIENT_ID: z.string().optional(),
  MS_TENANT_ID: z.string().default('common'),

  // Google
  GOOGLE_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  // IMAP
  IMAP_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  const config = result.data;

  // Validate provider-specific requirements
  if (config.MS_ENABLED && !config.MS_CLIENT_ID) {
    throw new Error('MS_CLIENT_ID is required when MS_ENABLED=true');
  }

  if (config.GOOGLE_ENABLED) {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw new Error(
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required when GOOGLE_ENABLED=true'
      );
    }
  }

  return config;
}

export const config = loadConfig();
