<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import type { OverviewDto, PlaytimeAnalyticsDto } from '@steam-analytics/shared';
import { api } from '@/services/api';
import { useApi } from '@/composables/useAsync';
import { useFormat } from '@/composables/useFormat';
import { useAuthStore } from '@/stores/auth';
import { useSteamStore } from '@/stores/steam';
import StatCard from '@/components/ui/StatCard.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';
import DataAsOf from '@/components/ui/DataAsOf.vue';
import UserProfileCard from '@/components/steam/UserProfileCard.vue';
import SteamRequired from '@/components/steam/SteamRequired.vue';
import BaseChart from '@/components/charts/BaseChart.vue';
import type { ChartOption } from '@/components/charts/types';

const authStore = useAuthStore();
const steam = useSteamStore();
const f = useFormat();

const overview = useApi(() => api.get<OverviewDto>('/analytics/overview'), [() => steam.dataRevision]);

onMounted(() => {
  if (authStore.steamLinked && !steam.profile) void steam.loadProfile();
});
watch(() => steam.dataRevision, () => void steam.loadProfile());

const lib = computed(() => steam.profile?.library);
const libraryHidden = computed(() => steam.profile?.gameDetailsVisible === false);

// Top 5 from the playtime analytics endpoint (cheap: the server caches the library).
const playtime = useApi(() => api.get<PlaytimeAnalyticsDto>('/analytics/playtime'), [() => steam.dataRevision]);
const playtimeTop = computed(() => playtime.data.value?.top10.slice(0, 5) ?? []);

const topChart = computed<ChartOption>(() => {
  const items = [...playtimeTop.value].reverse();
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => f.hours(Number(v) * 60) },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v}h` }, splitLine: { lineStyle: { opacity: 0.2 } } },
    yAxis: { type: 'category', data: items.map((g) => g.name), axisLabel: { width: 140, overflow: 'truncate' } },
    series: [{ type: 'bar', data: items.map((g) => Math.round((g.playtimeMinutes / 60) * 10) / 10), barMaxWidth: 18, itemStyle: { borderRadius: [0, 4, 4, 0] } }],
  };
});
</script>

<template>
  <SteamRequired>
    <div class="flex flex-col gap-6">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 class="text-2xl font-semibold">{{ $t('dashboard.title', { name: authStore.me?.displayName }) }}</h1>
          <DataAsOf :at="authStore.me?.lastSuccessfulSyncAt" />
        </div>
      </div>

      <ErrorState v-if="steam.profileError && !steam.profile" :error="steam.profileError" @retry="steam.loadProfile()" />
      <SkeletonBlock v-else-if="!steam.profile" class="h-32" />
      <UserProfileCard v-else :profile="steam.profile" :source="steam.profileSource" />

      <div v-if="libraryHidden" role="note" class="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
        <p class="font-medium text-warning">{{ $t('dashboard.privateTitle') }}</p>
        <p class="text-muted">{{ $t('dashboard.privateBody') }}</p>
      </div>
      <div v-else-if="steam.syncing && !authStore.me?.lastSuccessfulSyncAt" role="status" class="rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
        {{ $t('dashboard.firstSync') }}
      </div>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard :label="$t('stats.totalGames')" icon="library" :loading="!steam.profile" :unavailable="lib?.totalGames == null" :value="lib?.totalGames != null ? f.number(lib.totalGames) : null" />
        <StatCard :label="$t('stats.totalPlaytime')" icon="clock" :loading="!steam.profile" :unavailable="lib?.totalPlaytimeMinutes == null" :value="f.hours(lib?.totalPlaytimeMinutes)" />
        <StatCard
          :label="$t('stats.achievementsUnlocked')"
          icon="trophy"
          :loading="!steam.profile"
          :unavailable="lib?.totalAchievementsUnlocked == null"
          :value="lib?.totalAchievementsUnlocked != null ? f.number(lib.totalAchievementsUnlocked) : null"
          :hint="lib ? $t('stats.basedOnGames', { n: lib.gamesWithAchievementData }) : undefined"
        />
        <StatCard
          :label="$t('stats.estimatedValue')"
          icon="wallet"
          :loading="overview.loading.value"
          :unavailable="!overview.data.value?.libraryValue.totals.length"
          :value="f.totals(overview.data.value?.libraryValue.totals)"
          :hint="overview.data.value ? $t('stats.pricedOf', { priced: overview.data.value.libraryValue.pricedGames, total: overview.data.value.totalGames }) : undefined"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-5">
        <section class="card lg:col-span-3">
          <div class="mb-2 flex items-center justify-between">
            <h2 class="section-title">{{ $t('dashboard.topPlayed') }}</h2>
            <RouterLink :to="{ name: 'analytics' }" class="text-sm text-accent hover:underline">{{ $t('common.more') }}</RouterLink>
          </div>
          <ErrorState v-if="playtime.error.value" :error="playtime.error.value" compact @retry="playtime.reload" />
          <p v-else-if="!playtime.loading.value && playtimeTop.length === 0" class="py-10 text-center text-sm text-muted">{{ $t('common.noData') }}</p>
          <BaseChart v-else :option="topChart" :loading="playtime.loading.value" height="260px" :label="$t('dashboard.topPlayed')" />
        </section>

        <section class="card lg:col-span-2">
          <h2 class="section-title mb-3">{{ $t('dashboard.recent') }}</h2>
          <ul v-if="lib?.recentGames.length" class="flex flex-col gap-3">
            <li v-for="g in lib.recentGames" :key="g.appId">
              <RouterLink :to="{ name: 'game', params: { appid: g.appId } }" class="flex items-center gap-3 rounded-lg p-1 hover:bg-surface-2">
                <img :src="g.coverUrl" alt="" class="h-10 w-20 rounded object-cover" loading="lazy" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{{ g.name }}</p>
                  <p class="text-xs text-muted">{{ $t('dashboard.recentHours', { recent: f.hours(g.playtime2WeeksMinutes), total: f.hours(g.playtimeForeverMinutes) }) }}</p>
                </div>
              </RouterLink>
            </li>
          </ul>
          <p v-else class="py-6 text-center text-sm text-muted">{{ $t('dashboard.noRecent') }}</p>
        </section>
      </div>
    </div>
  </SteamRequired>
</template>
