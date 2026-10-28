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
  /** Directory of the built frontend to serve from this server (App Hosting). Unset = API only. */
  FRONTEND_DIST: z.string().optional(),
  STEAM_API_KEY: z.string().regex(/^[A-F0-9]{32}$/i, 'STEAM_API_KEY must be a 32-character hex key'),
  REQUIRE_EMAIL_VERIFIED: bool.default(true),
  CRON_SECRET: z
    .string()
    .default('')
    .refine((s) => s === '' || s.length >= 32, 'CRON_SECRET must be at least 32 characters'),
  /** Enables purchase import from screenshots (Claude vision). Unset = feature disabled. */
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => v?.trim() || undefined),
  IMPORT_MODEL: z.string().min(1).default('claude-opus-5-5'),
  SYNC_ACHIEVEMENT_BATCH: z.coerce.number().int().min(1).max(5000).default(200),
  SYNC_METADATA_BATCH: z.coerce.number().int().min(1).max(5000).default(150),
});

export type Env = z.infer<typeof envSchema>;

/** Firebase App Hosting / Cloud Run provide the project via FIREBASE_CONFIG or GOOGLE_CLOUD_PROJECT. */
function defaultProjectId(source: NodeJS.ProcessEnv): string | undefined {
  try {
    const fromConfig = source.FIREBASE_CONFIG ? (JSON.parse(source.FIREBASE_CONFIG) as { projectId?: string }).projectId : undefined;
    return fromConfig ?? source.GOOGLE_CLOUD_PROJECT;
  } catch {
    return source.GOOGLE_CLOUD_PROJECT;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse({ ...source, FIREBASE_PROJECT_ID: source.FIREBASE_PROJECT_ID || defaultProjectId(source) });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
