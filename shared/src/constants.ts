export const SUPPORTED_LANGUAGES = ['en', 'zh-CN'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/** ISO 4217 codes users may record purchases in. */
export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CNY', 'JPY', 'KRW', 'HKD', 'TWD', 'CAD', 'AUD',
  'NZD', 'SGD', 'RUB', 'BRL', 'MXN', 'INR', 'PLN', 'CHF', 'SEK', 'NOK', 'TRY', 'UAH',
] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

/**
 * Steam Store regions (country code passed as `cc` to appdetails).
 * `currency` is the currency Steam is expected to answer with; the actual
 * currency returned by Steam is always stored and displayed.
 */
export const STORE_REGIONS = [
  { code: 'us', currency: 'USD' },
  { code: 'gb', currency: 'GBP' },
  { code: 'de', currency: 'EUR' },
  { code: 'fr', currency: 'EUR' },
  { code: 'cn', currency: 'CNY' },
  { code: 'jp', currency: 'JPY' },
  { code: 'kr', currency: 'KRW' },
  { code: 'hk', currency: 'HKD' },
  { code: 'tw', currency: 'TWD' },
  { code: 'ca', currency: 'CAD' },
  { code: 'au', currency: 'AUD' },
  { code: 'nz', currency: 'NZD' },
  { code: 'sg', currency: 'SGD' },
  { code: 'br', currency: 'BRL' },
  { code: 'mx', currency: 'MXN' },
  { code: 'in', currency: 'INR' },
  { code: 'pl', currency: 'PLN' },
  { code: 'ch', currency: 'CHF' },
  { code: 'se', currency: 'SEK' },
  { code: 'no', currency: 'NOK' },
  { code: 'ua', currency: 'UAH' },
] as const;
export type StoreRegion = (typeof STORE_REGIONS)[number]['code'];
export const STORE_REGION_CODES = STORE_REGIONS.map((r) => r.code) as [StoreRegion, ...StoreRegion[]];

export const PURCHASE_SOURCES = [
  'steam', 'steam_gift', 'bundle', 'key_store', 'retail', 'subscription', 'free', 'other',
] as const;
export type PurchaseSource = (typeof PURCHASE_SOURCES)[number];

export const STEAM_PERSONA_STATES = [
  'offline', 'online', 'busy', 'away', 'snooze', 'looking_to_trade', 'looking_to_play',
] as const;
export type SteamPersonaState = (typeof STEAM_PERSONA_STATES)[number];

export const steamCoverUrl = (appId: number) =>
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;

export const steamIconUrl = (appId: number, hash: string | null | undefined) =>
  hash ? `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${hash}.jpg` : null;
