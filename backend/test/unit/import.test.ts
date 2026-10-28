import { describe, expect, it } from 'vitest';
import { GameMatcher, classifyItem, normalizeTitle, sniffImageType } from '../../src/services/importService';
import type { LibraryEntry } from '../../src/services/libraryService';

const entry = (appId: number, name: string, type: string | null = 'game'): LibraryEntry =>
  ({
    game: { appId, name },
    meta: type ? { appId, type, isFree: false, name, storeStatus: 'ok', fetchedAt: new Date() } : undefined,
    price: { status: 'unknown', amount: null, currency: null, initialAmount: null, discountPercent: null, fetchedAt: null },
    purchase: undefined,
  }) as unknown as LibraryEntry;

const matcher = new GameMatcher([
  entry(1091500, 'Cyberpunk 2077'),
  entry(292030, 'The Witcher® 3: Wild Hunt'),
  entry(1245620, 'ELDEN RING'),
  entry(431960, 'Wallpaper Engine', 'application'),
]);

describe('normalizeTitle', () => {
  it('ignores case, symbols and punctuation', () => {
    expect(normalizeTitle('The Witcher® 3: Wild Hunt')).toBe('the witcher 3 wild hunt');
    expect(normalizeTitle('Tom Clancy’s Rainbow Six® Siege')).toBe('tom clancy s rainbow six siege');
  });
});

describe('GameMatcher', () => {
  it('matches exact names and edition variants', () => {
    expect(matcher.match('ELDEN RING')?.game.appId).toBe(1245620);
    expect(matcher.match('The Witcher 3: Wild Hunt')?.game.appId).toBe(292030);
    expect(matcher.match('Cyberpunk 2077 Ultimate Edition')?.game.appId).toBe(1091500);
    expect(matcher.match('Elden Ring Deluxe Edition')?.game.appId).toBe(1245620);
  });

  it('does not match unrelated titles', () => {
    expect(matcher.match('Cyberpunk 2077: Phantom Liberty')).toBeNull();
    expect(matcher.match('Portal 2')).toBeNull();
  });
});

describe('classifyItem', () => {
  const recorded = new Set([1245620]);

  it('marks owned games and existing records', () => {
    expect(classifyItem('Cyberpunk 2077', 'purchase', matcher, recorded)).toMatchObject({ kind: 'game', appId: 1091500, alreadyRecorded: false });
    expect(classifyItem('ELDEN RING', 'gift_purchase', matcher, recorded)).toMatchObject({ kind: 'game', alreadyRecorded: true });
  });

  it('filters non-game items', () => {
    expect(classifyItem('Cyberpunk 2077: Phantom Liberty DLC', 'purchase', matcher, recorded)).toMatchObject({ kind: 'non_game', reason: 'dlc' });
    expect(classifyItem('ELDEN RING Soundtrack', 'purchase', matcher, recorded)).toMatchObject({ kind: 'non_game', reason: 'soundtrack' });
    expect(classifyItem('Wallpaper Engine', 'purchase', matcher, recorded)).toMatchObject({ kind: 'non_game', reason: 'software', appId: 431960 });
    expect(classifyItem('Cyberpunk 2077', 'refund', matcher, recorded)).toMatchObject({ kind: 'non_game', reason: 'refund', appId: null });
    expect(classifyItem('Steam Community Market', 'market', matcher, recorded)).toMatchObject({ kind: 'non_game', reason: 'market' });
    expect(classifyItem('$20.00 Wallet Credit', 'wallet_credit', matcher, recorded)).toMatchObject({ kind: 'non_game', reason: 'wallet_credit' });
  });

  it('leaves unknown games as unmatched', () => {
    expect(classifyItem('Hollow Knight', 'purchase', matcher, recorded)).toMatchObject({ kind: 'unmatched', appId: null });
  });
});

describe('sniffImageType', () => {
  it('detects formats from magic bytes', () => {
    expect(sniffImageType(Buffer.from('89504e470d0a1a0a0000000000', 'hex'))).toBe('image/png');
    expect(sniffImageType(Buffer.from('ffd8ffe000104a4649460001', 'hex'))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('RIFF0000WEBPVP8 ', 'ascii'))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', 'ascii'))).toBeNull();
  });
});
