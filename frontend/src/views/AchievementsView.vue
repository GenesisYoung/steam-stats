<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AchievementAnalyticsDto } from '@steam-analytics/shared';
import { api } from '@/services/api';
import { useApi } from '@/composables/useAsync';
import { useFormat } from '@/composables/useFormat';
import { useSteamStore } from '@/stores/steam';
import SteamRequired from '@/components/steam/SteamRequired.vue';
import AchievementProgress from '@/components/steam/AchievementProgress.vue';
import StatCard from '@/components/ui/StatCard.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';
import DataAsOf from '@/components/ui/DataAsOf.vue';

const steam = useSteamStore();
const f = useFormat();
const res = useApi(() => api.get<AchievementAnalyticsDto>('/analytics/achievements'), [() => steam.dataRevision]);

const filter = ref<'all' | 'perfect' | 'progress' | 'none'>('all');
const search = ref('');
const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (res.data.value?.byGame ?? []).filter((g) => {
    if (filter.value === 'perfect' && g.unlocked < g.total) return false;
    if (filter.value === 'progress' && (g.unlocked === 0 || g.unlocked >= g.total)) return false;
    if (filter.value === 'none' && g.unlocked > 0) return false;
    return !q || g.name.toLowerCase().includes(q);
  });
});
</script>

<template>
  <SteamRequired>
    <div class="flex flex-col gap-6">
      <div>
        <h1 class="text-2xl font-semibold">{{ $t('achievements.explorerTitle') }}</h1>
        <DataAsOf :at="res.meta.value?.dataAsOf" />
      </div>
      <ErrorState v-if="res.error.value" :error="res.error.value" @retry="res.reload" />
      <template v-else>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard :label="$t('stats.achievementsUnlocked')" icon="trophy" :loading="res.loading.value" :value="res.data.value ? f.number(res.data.value.totalUnlocked) : null" :hint="res.data.value ? $t('achievements.ofAvailable', { n: f.number(res.data.value.totalAvailable) }) : undefined" />
          <StatCard :label="$t('stats.completionRate')" icon="chart" :loading="res.loading.value" :unavailable="res.data.value?.completionRate == null" :value="f.percent(res.data.value?.completionRate)" :hint="$t('stats.completionHint')" />
          <StatCard :label="$t('achievements.perfectGames')" icon="check" :loading="res.loading.value" :value="res.data.value ? f.number(res.data.value.perfectGames) : null" />
          <StatCard
            :label="$t('achievements.coverage')"
            icon="info"
            :loading="res.loading.value"
            :value="res.data.value ? $t('achievements.coverageValue', { n: res.data.value.gamesWithData }) : null"
            :hint="res.data.value ? $t('achievements.coverageHint', { none: res.data.value.gamesWithoutAchievements, pending: res.data.value.gamesPendingSync, private: res.data.value.gamesPrivateOrError }) : undefined"
          />
        </div>

        <section class="card flex flex-col gap-4">
          <div class="flex flex-col gap-2 sm:flex-row">
            <input v-model="search" type="search" class="input sm:max-w-xs" :placeholder="$t('filters.searchPlaceholder')" :aria-label="$t('filters.search')" />
            <select v-model="filter" class="input sm:w-48" :aria-label="$t('filters.filter')">
              <option value="all">{{ $t('filters.all') }}</option>
              <option value="perfect">{{ $t('achievements.filterPerfect') }}</option>
              <option value="progress">{{ $t('achievements.filterProgress') }}</option>
              <option value="none">{{ $t('achievements.filterNone') }}</option>
            </select>
          </div>
          <SkeletonBlock v-if="res.loading.value" class="h-64" />
          <EmptyState v-else-if="rows.length === 0" icon="trophy" :title="$t('achievements.emptyTitle')" :description="res.data.value?.gamesPendingSync ? $t('achievements.pendingHint') : undefined" />
          <ul v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <li v-for="g in rows" :key="g.appId">
              <RouterLink :to="{ name: 'game', params: { appid: g.appId } }" class="flex flex-col gap-2 rounded-lg border border-line p-3 hover:border-accent/60">
                <span class="truncate font-medium">{{ g.name }}</span>
                <AchievementProgress :summary="{ status: 'available', total: g.total, unlocked: g.unlocked, percent: g.percent }" />
              </RouterLink>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </SteamRequired>
</template>
