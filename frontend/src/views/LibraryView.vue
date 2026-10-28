<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { GAME_SORT_KEYS, type GameListItemDto, type GameSortKey } from '@steam-analytics/shared';
import { api } from '@/services/api';
import { useApi } from '@/composables/useAsync';
import { useFormat } from '@/composables/useFormat';
import { useSteamStore } from '@/stores/steam';
import SteamRequired from '@/components/steam/SteamRequired.vue';
import GameFilters from '@/components/steam/GameFilters.vue';
import type { FilterState } from '@/components/steam/filters';
import GameCard from '@/components/steam/GameCard.vue';
import GameVisibilityControls from '@/components/steam/GameVisibilityControls.vue';
import PriceTag from '@/components/steam/PriceTag.vue';
import AchievementProgress from '@/components/steam/AchievementProgress.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';
import DataAsOf from '@/components/ui/DataAsOf.vue';
import AppIcon from '@/components/ui/AppIcon.vue';

const PAGE_SIZE = 48;
const route = useRoute();
const router = useRouter();
const steam = useSteamStore();
const f = useFormat();

const tri = (v: unknown): FilterState['played'] => (v === 'yes' || v === 'no' ? v : 'all');
const fromQuery = (): FilterState => ({
  q: typeof route.query.q === 'string' ? route.query.q : '',
  sort: GAME_SORT_KEYS.includes(route.query.sort as GameSortKey) ? (route.query.sort as GameSortKey) : 'playtime',
  order: route.query.order === 'asc' || route.query.order === 'desc' ? route.query.order : undefined,
  played: tri(route.query.played),
  achievements: tri(route.query.achievements),
});

const filters = ref<FilterState>(fromQuery());
const visibility = ref<'visible' | 'hidden'>(route.query.visibility === 'hidden' ? 'hidden' : 'visible');
const page = ref(Number(route.query.page) > 0 ? Number(route.query.page) : 1);
const view = ref<'grid' | 'list'>('grid');
const debouncedQ = ref(filters.value.q);
let timer: ReturnType<typeof setTimeout> | undefined;

watch(() => filters.value.q, (q) => {
  clearTimeout(timer);
  timer = setTimeout(() => (debouncedQ.value = q), 250);
});
watch(() => [filters.value.sort, filters.value.order, filters.value.played, filters.value.achievements, debouncedQ.value, visibility.value], () => (page.value = 1));

const query = computed(() => ({ ...filters.value, q: debouncedQ.value, visibility: visibility.value, page: page.value, pageSize: PAGE_SIZE }));
watch(query, (q) => {
  const next: Record<string, string> = {};
  if (q.q) next.q = q.q;
  if (q.sort !== 'playtime') next.sort = q.sort;
  if (q.order) next.order = q.order;
  if (q.played !== 'all') next.played = q.played;
  if (q.achievements !== 'all') next.achievements = q.achievements;
  if (q.visibility === 'hidden') next.visibility = 'hidden';
  if (q.page > 1) next.page = String(q.page);
  void router.replace({ query: next });
});

const games = useApi(() => api.get<GameListItemDto[]>('/steam/games', query.value), [query, () => steam.dataRevision]);
const total = computed(() => games.meta.value?.total ?? 0);
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
watch(pages, (count) => { if (page.value > count) page.value = count; });

// Keep the selected list in sync with browser back/forward navigation.
watch(() => route.query.visibility, (value) => { visibility.value = value === 'hidden' ? 'hidden' : 'visible'; });
</script>

<template>
  <SteamRequired>
    <div class="flex flex-col gap-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold">{{ $t('library.title') }}</h1>
          <DataAsOf :at="games.meta.value?.dataAsOf" />
        </div>
        <div class="flex gap-1" role="group" :aria-label="$t('library.viewMode')">
          <button type="button" class="btn px-2" :class="view === 'grid' ? 'btn-secondary' : 'btn-ghost'" :aria-pressed="view === 'grid'" :aria-label="$t('library.grid')" @click="view = 'grid'"><AppIcon name="grid" :size="16" /></button>
          <button type="button" class="btn px-2" :class="view === 'list' ? 'btn-secondary' : 'btn-ghost'" :aria-pressed="view === 'list'" :aria-label="$t('library.list')" @click="view = 'list'"><AppIcon name="list" :size="16" /></button>
        </div>
      </div>

      <div class="flex gap-2" role="group" :aria-label="$t('library.visibility')">
        <button type="button" class="btn" :class="visibility === 'visible' ? 'btn-primary' : 'btn-secondary'" :aria-pressed="visibility === 'visible'" @click="visibility = 'visible'">{{ $t('library.visibleGames') }}</button>
        <button type="button" class="btn" :class="visibility === 'hidden' ? 'btn-primary' : 'btn-secondary'" :aria-pressed="visibility === 'hidden'" @click="visibility = 'hidden'">{{ $t('library.hiddenGames') }}</button>
      </div>
      <p v-if="visibility === 'hidden'" class="text-sm text-muted">{{ $t('library.hiddenHint') }}</p>
      <GameFilters v-model="filters" />

      <ErrorState v-if="games.error.value" :error="games.error.value" @retry="games.reload" />
      <div v-else-if="games.loading.value && !games.data.value" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <SkeletonBlock v-for="n in 8" :key="n" class="h-72 rounded-xl" />
      </div>
      <EmptyState v-else-if="games.data.value && games.data.value.length === 0" icon="search" :title="$t(visibility === 'hidden' ? 'library.hiddenEmptyTitle' : 'library.emptyTitle')" :description="$t(visibility === 'hidden' ? 'library.hiddenEmptyDescription' : 'library.emptyDescription')" />
      <template v-else-if="games.data.value">
        <p class="text-sm text-muted" aria-live="polite">{{ $t('library.count', { n: f.number(total) }) }}</p>
        <div v-if="view === 'grid'" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" :class="{ 'opacity-60': games.loading.value }">
          <div v-for="g in games.data.value" :key="g.appId" class="flex flex-col gap-2">
            <GameCard :game="g" class="flex-1" />
            <GameVisibilityControls :game="g" />
          </div>
        </div>
        <div v-else class="card overflow-x-auto p-0">
          <table class="w-full min-w-[56rem] text-sm">
            <thead class="border-b border-line text-left text-xs text-muted uppercase">
              <tr>
                <th class="px-4 py-3">{{ $t('game.name') }}</th>
                <th class="px-4 py-3">AppID</th>
                <th class="px-4 py-3 text-right">{{ $t('game.playtime') }}</th>
                <th class="px-4 py-3 text-right">{{ $t('game.recent') }}</th>
                <th class="px-4 py-3">{{ $t('game.lastPlayed') }}</th>
                <th class="w-40 px-4 py-3">{{ $t('nav.achievements') }}</th>
                <th class="px-4 py-3 text-right">{{ $t('game.price') }}</th>
                <th class="px-4 py-3 text-right">{{ $t('cost.estimatedPerHour') }}</th>
                <th class="px-4 py-3">{{ $t('library.visibility') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in games.data.value" :key="g.appId" class="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                <td class="px-4 py-2"><RouterLink :to="{ name: 'game', params: { appid: g.appId } }" class="font-medium hover:text-accent">{{ g.name }}</RouterLink></td>
                <td class="px-4 py-2 font-mono text-xs text-muted">{{ g.appId }}</td>
                <td class="px-4 py-2 text-right">{{ g.playtimeForeverMinutes > 0 ? f.hours(g.playtimeForeverMinutes) : $t('cost.notPlayed') }}</td>
                <td class="px-4 py-2 text-right">{{ f.hours(g.playtime2WeeksMinutes) }}</td>
                <td class="px-4 py-2">{{ f.date(g.lastPlayedAt) }}</td>
                <td class="px-4 py-2"><AchievementProgress :summary="g.achievements" /></td>
                <td class="px-4 py-2 text-right"><PriceTag :price="g.price" /></td>
                <td class="px-4 py-2 text-right">{{ f.costPerHour(g.estimatedCostPerHour) }}</td>
                <td class="px-4 py-2"><GameVisibilityControls :game="g" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav v-if="pages > 1" class="flex items-center justify-center gap-2" :aria-label="$t('library.pagination')">
          <button type="button" class="btn btn-secondary" :disabled="page <= 1" @click="page--">{{ $t('common.previous') }}</button>
          <span class="text-sm text-muted">{{ $t('library.page', { page, pages }) }}</span>
          <button type="button" class="btn btn-secondary" :disabled="page >= pages" @click="page++">{{ $t('common.next') }}</button>
        </nav>
      </template>
    </div>
  </SteamRequired>
</template>
