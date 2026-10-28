import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import type { GameListItemDto } from '@steam-analytics/shared';
import en from '../src/locales/en';
import GameVisibilityControls from '../src/components/steam/GameVisibilityControls.vue';

const actions = vi.hoisted(() => ({ setGameVisibility: vi.fn() }));
vi.mock('@/stores/steam', () => ({ useSteamStore: () => actions }));
vi.mock('@/components/ui/ErrorState.vue', () => ({ default: {
  props: ['error', 'compact'], emits: ['retry'], template: '<div role="alert"><button @click="$emit(\'retry\')">Retry</button></div>',
} }));

const render = (hidden = false, excludedFromStats = false) => mount(GameVisibilityControls, {
  props: { game: { appId: 10, name: 'Game', hidden, excludedFromStats } as GameListItemDto },
  global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
});

beforeEach(() => actions.setGameVisibility.mockReset().mockResolvedValue(undefined));

describe('game visibility controls', () => {
  it('hides with statistics excluded by default', async () => {
    const w = render();
    await w.get('button').trigger('click');
    await flushPromises();
    expect(actions.setGameVisibility).toHaveBeenCalledWith(10, { hidden: true, excludeFromStats: true });
  });

  it('lets a hidden game contribute to statistics without unhiding it', async () => {
    const w = render(true, true);
    await w.get('input[type="checkbox"]').setValue(false);
    await flushPromises();
    expect(actions.setGameVisibility).toHaveBeenCalledWith(10, { hidden: true, excludeFromStats: false });
  });

  it('restores a hidden game', async () => {
    const w = render(true, true);
    await w.get('button').trigger('click');
    await flushPromises();
    expect(actions.setGameVisibility).toHaveBeenCalledWith(10, { hidden: false, excludeFromStats: true });
  });

  it('shows a failed save and retries the same choice', async () => {
    actions.setGameVisibility.mockRejectedValueOnce(new Error('Offline'));
    const w = render(true, true);
    await w.get('input[type="checkbox"]').setValue(false);
    await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(true);
    expect(w.get('button').attributes('disabled')).toBeUndefined();
    await w.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(actions.setGameVisibility).toHaveBeenLastCalledWith(10, { hidden: true, excludeFromStats: false });
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });
});
