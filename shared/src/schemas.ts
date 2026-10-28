import { z } from 'zod';
import {
  CURRENCIES, IMPORT_TRANSACTION_TYPES, PURCHASE_SOURCES, STORE_REGION_CODES, SUPPORTED_LANGUAGES, THEMES,
} from './constants';

export const steamIdSchema = z.string().regex(/^7656119\d{10}$/, 'Invalid SteamID64');
export const appIdSchema = z.coerce.number().int().positive().max(2 ** 31 - 1);

export const userPreferencesSchema = z.object({
  currency: z.enum(CURRENCIES),
  language: z.enum(SUPPORTED_LANGUAGES),
  storeRegion: z.enum(STORE_REGION_CODES),
  theme: z.enum(THEMES),
  autoSync: z.boolean(),
});

export const updateMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50),
    preferences: userPreferencesSchema.partial(),
  })
  .partial()
  .strict()
  .refine((v) => v.displayName !== undefined || v.preferences !== undefined, 'Nothing to update');
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const GAME_SORT_KEYS = ['playtime', 'name', 'achievements', 'price', 'costPerHour', 'lastPlayed', 'recent'] as const;
export type GameSortKey = (typeof GAME_SORT_KEYS)[number];

const triState = z.enum(['all', 'yes', 'no']).default('all');

export const gameListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(GAME_SORT_KEYS).default('playtime'),
  order: z.enum(['asc', 'desc']).optional(),
  played: triState,
  achievements: triState,
  visibility: z.enum(['visible', 'hidden', 'all']).default('visible'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(48),
});
export type GameListQuery = z.infer<typeof gameListQuerySchema>;

export const gameVisibilitySchema = z.object({
  hidden: z.boolean(),
  excludeFromStats: z.boolean().default(true),
}).strict();
export type GameVisibilityInput = z.infer<typeof gameVisibilitySchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date');

export const purchaseInputSchema = z
  .object({
    amount: z
      .number()
      .min(0)
      .max(100_000)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most 2 decimals'),
    currency: z.enum(CURRENCIES),
    purchaseDate: isoDate
      .refine((s) => Date.parse(`${s}T00:00:00Z`) <= Date.now() + 86_400_000, 'Date is in the future')
      .nullable()
      .default(null),
    source: z.enum(PURCHASE_SOURCES).default('steam'),
    notes: z.string().trim().max(500).default(''),
  })
  .strict();
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

export const syncRequestSchema = z.object({ scope: z.enum(['profile', 'full']).default('full') }).strict();

export const analyticsQuerySchema = z.object({
  basis: z.enum(['estimated', 'actual']).default('estimated'),
});

const money = z
  .number()
  .min(0)
  .max(100_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most 2 decimals');

const optionalPastDate = isoDate
  .refine((s) => Date.parse(`${s}T00:00:00Z`) <= Date.now() + 86_400_000, 'Date is in the future')
  .nullable()
  .default(null);

/** Several games bought together for one price. */
export const bundleInputSchema = z
  .object({
    appIds: z.array(appIdSchema).min(2).max(100),
    total: money,
    currency: z.enum(CURRENCIES),
    purchaseDate: optionalPastDate,
    source: z.enum(PURCHASE_SOURCES).default('bundle'),
    notes: z.string().trim().max(500).default(''),
    allocation: z.enum(['store_price', 'even', 'manual']).default('store_price'),
    /** Required for allocation "manual": one share per appId, adding up to total. */
    shares: z.array(z.object({ appId: appIdSchema, amount: money })).optional(),
    /** Overwrite existing single-game records for these games. */
    replaceExisting: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.appIds).size !== v.appIds.length) ctx.addIssue({ code: 'custom', path: ['appIds'], message: 'Duplicate games' });
    if (v.allocation !== 'manual') return;
    if (!v.shares) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Shares are required for manual allocation' });
      return;
    }
    const ids = new Set(v.shares.map((s) => s.appId));
    if (ids.size !== v.appIds.length || !v.appIds.every((id) => ids.has(id))) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: 'One share per game is required' });
    }
    const sum = v.shares.reduce((a, s) => a + Math.round(s.amount * 100), 0);
    if (sum !== Math.round(v.total * 100)) ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Shares must add up to the total' });
  });
export type BundleInput = z.infer<typeof bundleInputSchema>;

export const IMPORT_MAX_TRANSACTIONS = 2000;

/** Transactions parsed from a CSV / Excel file in the browser, sent for matching. */
export const importPreviewSchema = z
  .object({
    transactions: z
      .array(
        z
          .object({
            date: isoDate.nullable(),
            type: z.enum(IMPORT_TRANSACTION_TYPES).default('purchase'),
            total: money.nullable(),
            currency: z.enum(CURRENCIES).nullable(),
            source: z.enum(PURCHASE_SOURCES).nullable().default(null),
            notes: z.string().trim().max(500).default(''),
            items: z
              .array(z.object({ name: z.string().trim().min(1).max(300), amount: money.nullable().default(null) }).strict())
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(IMPORT_MAX_TRANSACTIONS),
  })
  .strict();
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;

/** Reviewed transactions to save after an import. */
export const importCommitSchema = z
  .object({
    transactions: z
      .array(
        z
          .object({
            appIds: z.array(appIdSchema).min(1).max(100),
            total: money,
            currency: z.enum(CURRENCIES),
            purchaseDate: optionalPastDate,
            source: z.enum(PURCHASE_SOURCES).default('steam'),
            notes: z.string().trim().max(500).default(''),
            /** Known per-game prices for a bundle; must add up to total. Omit to split by store price. */
            shares: z.array(z.object({ appId: appIdSchema, amount: money })).optional(),
          })
          .strict()
          .superRefine((t, ctx) => {
            if (!t.shares) return;
            const ids = new Set(t.shares.map((s) => s.appId));
            if (ids.size !== t.appIds.length || !t.appIds.every((id) => ids.has(id))) {
              ctx.addIssue({ code: 'custom', path: ['shares'], message: 'One share per game is required' });
            }
            const sum = t.shares.reduce((a, s) => a + Math.round(s.amount * 100), 0);
            if (sum !== Math.round(t.total * 100)) ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Shares must add up to the total' });
          }),
      )
      .min(1)
      .max(IMPORT_MAX_TRANSACTIONS),
    replaceExisting: z.boolean().default(false),
  })
  .strict();
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
