import { z } from 'zod';
import {
  CURRENCIES, PURCHASE_SOURCES, STORE_REGION_CODES, SUPPORTED_LANGUAGES, THEMES,
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
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(48),
});
export type GameListQuery = z.infer<typeof gameListQuerySchema>;

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
