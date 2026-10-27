import { describe, expect, it } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import type { GameListItemDto } from '@steam-analytics/shared';
import en from '../src/locales/en';
import GameCard from '../src/components/steam/GameCard.vue';
import AchievementProgress from '../src/components/steam/AchievementProgress.vue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });
const global = () => ({ plugins: [i18n()], stubs: { RouterLink: RouterLinkStub } });

const game = (over: Partial<GameListItemDto> = {}): GameListItemDto => ({
  appId: 10,
  name: 'Test Game',
  coverUrl: 'https://example.test/c.jpg',
  iconUrl: null,
  playtimeForeverMinutes: 0,
  playtimeHours: 0,
  playtime2WeeksMinutes: 0,
  lastPlayedAt: null,
  achievements: { status: 'unknown', total: null, unlocked: null, percent: null },
  price: { status: 'unknown', price: null, initialPrice: null, discountPercent: null, region: 'us', fetchedAt: null },
  estimatedCostPerHour: { status: 'no_price' },
  purchase: null,
  actualCostPerHour: null,
  ...over,
});

describe('GameCard', () => {
  it('shows explicit unavailable / not played states instead of zero', () => {
    const w = mount(GameCard, { props: { game: game() }, global: global() });
    expect(w.text()).toContain('Not played');
    expect(w.text()).toContain('Unavailable');
    expect(w.text()).toContain('Achievements not synced yet');
    expect(w.text()).not.toContain('$0');
  });

  it('shows price and cost per hour when known', () => {
    const w = mount(GameCard, {
      props: {
        game: game({
          playtimeForeverMinutes: 7200,
          price: { status: 'priced', price: { amount: 59.99, currency: 'USD' }, initialPrice: null, discountPercent: 0, region: 'us', fetchedAt: null },
          estimatedCostPerHour: { status: 'ok', value: { amount: 0.4999, currency: 'USD' } },
        }),
      },
      global: global(),
    });
    expect(w.text()).toContain('$59.99');
    expect(w.text()).toContain('$0.50/h');
    expect(w.text()).toContain('120 h');
  });
});

describe('AchievementProgress', () => {
  it('renders progress for available data', () => {
    const w = mount(AchievementProgress, { props: { summary: { status: 'available', total: 4, unlocked: 2, percent: 50 } }, global: global() });
    expect(w.text()).toContain('2 / 4');
    expect(w.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('50');
  });

  it('distinguishes games without achievements from private data', () => {
    expect(mount(AchievementProgress, { props: { summary: { status: 'none', total: 0, unlocked: 0, percent: null } }, global: global() }).text()).toBe('No achievements');
    expect(mount(AchievementProgress, { props: { summary: { status: 'private', total: null, unlocked: null, percent: null } }, global: global() }).text()).toBe('Achievements private');
  });
});
