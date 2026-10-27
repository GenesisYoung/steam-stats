import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const origin = z.url().transform((u) => new URL(u).origin);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  PUBLIC_APP_URL: origin,
  PUBLIC_API_URL: origin,
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  FIREBASE_PROJECT_ID: z.string().min(1),
  STEAM_API_KEY: z.string().regex(/^[A-F0-9]{32}$/i, 'STEAM_API_KEY must be a 32-character hex key'),
  REQUIRE_EMAIL_VERIFIED: bool.default(true),
  CRON_SECRET: z
    .string()
    .default('')
    .refine((s) => s === '' || s.length >= 32, 'CRON_SECRET must be at least 32 characters'),
  SYNC_ACHIEVEMENT_BATCH: z.coerce.number().int().min(1).max(5000).default(200),
  SYNC_METADATA_BATCH: z.coerce.number().int().min(1).max(5000).default(150),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
