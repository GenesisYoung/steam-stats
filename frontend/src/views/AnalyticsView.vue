<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CostEfficiencyDto, CostEfficiencyItemDto, PlaytimeAnalyticsDto } from '@steam-analytics/shared';
import { api } from '@/services/api';
import { useApi } from '@/composables/useAsync';
import { useFormat } from '@/composables/useFormat';
import { useSteamStore } from '@/stores/steam';
import SteamRequired from '@/components/steam/SteamRequired.vue';
import BaseChart from '@/components/charts/BaseChart.vue';
import type { ChartOption } from '@/components/charts/types';
import StatCard from '@/components/ui/StatCard.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import DataAsOf from '@/components/ui/DataAsOf.vue';

const { t } = useI18n();
const f = useFormat();
const steam = useSteamStore();
const basis = ref<'estimated' | 'actual'>('estimated');
const trendMode = ref<'daily' | 'monthly'>('daily');

const playtime = useApi(() => api.get<PlaytimeAnalyticsDto>('/analytics/playtime'), [() => steam.dataRevision]);
const cost = useApi(() => api.get<CostEfficiencyDto>('/analytics/cost-efficiency', { basis: basis.value }), [basis, () => steam.dataRevision]);

const hoursOf = (m: number) => Math.round((m / 60) * 10) / 10;
const p = computed(() => playtime.data.value);

const top10Option = computed<ChartOption>(() => {
  const items = [...(p.value?.top10 ?? [])].reverse();
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const i = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
        const g = items[i];
        return g ? `${g.name}<br/>${f.hours(g.playtimeMinutes)} · ${t('analytics.shareOfTotal', { pct: f.percent(g.share) })}` : '';
      },
    },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v}h` }, splitLine: { lineStyle: { opacity: 0.2 } } },
    yAxis: { type: 'category', data: items.map((g) => g.name), axisLabel: { width: 150, overflow: 'truncate' } },
    series: [{ type: 'bar', name: t('game.playtime'), data: items.map((g) => hoursOf(g.playtimeMinutes)), barMaxWidth: 18, itemStyle: { borderRadius: [0, 4, 4, 0] } }],
  };
});

const distributionOption = computed<ChartOption>(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  xAxis: { type: 'category', data: (p.value?.distribution ?? []).map((b) => b.bucket) },
  yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { opacity: 0.2 } } },
  series: [{ type: 'bar', name: t('analytics.games'), data: (p.value?.distribution ?? []).map((b) => b.count), barMaxWidth: 36, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
}));

const playedOption = computed<ChartOption>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: 0 },
  series: [{
    type: 'pie',
    radius: ['45%', '70%'],
    avoidLabelOverlap: true,
    label: { show: false },
    data: [
      { name: t('analytics.played'), value: p.value?.playedGames ?? 0 },
      { name: t('analytics.unplayed'), value: p.value?.unplayedGames ?? 0 },
    ],
  }],
}));

const trendPoints = computed(() => {
  const trend = p.value?.trend;
  if (!trend) return [];
  return trendMode.value === 'daily' ? trend.daily.map((d) => ({ x: d.date, m: d.minutes })) : trend.monthly.map((d) => ({ x: d.month, m: d.minutes }));
});
const trendOption = computed<ChartOption>(() => ({
  tooltip: { trigger: 'axis', valueFormatter: (v) => f.hours(Number(v) * 60) },
  xAxis: { type: 'category', data: trendPoints.value.map((d) => d.x) },
  yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v}h` }, splitLine: { lineStyle: { opacity: 0.2 } } },
  dataZoom: trendPoints.value.length > 30 ? [{ type: 'inside' }] : [],
  series: [{ type: trendMode.value === 'daily' ? 'line' : 'bar', name: t('analytics.playtimeGained'), smooth: true, areaStyle: { opacity: 0.15 }, data: trendPoints.value.map((d) => hoursOf(d.m)) }],
}));

const metric = (i: CostEfficiencyItemDto) => (basis.value === 'actual' ? i.actual : i.estimated);
const scatterItems = computed(() => (cost.data.value?.items ?? []).filter((i) => metric(i)?.status === 'ok'));
const scatterCurrencies = computed(() => [...new Set(scatterItems.value.map((i) => (metric(i) as { value: { currency: string } }).value.currency))]);
const scatterOption = computed<ChartOption>(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (params: unknown) => {
      const d = (params as { data: [number, number, string, string] }).data;
      return `${d[2]}<br/>${t('game.playtime')}: ${d[0]}h<br/>${t('cost.perHour')}: ${f.money({ amount: d[1], currency: d[3] }, 2)}`;
    },
  },
  legend: { top: 0 },
  xAxis: { type: 'log', name: t('analytics.hoursAxis'), nameLocation: 'middle', nameGap: 28, splitLine: { lineStyle: { opacity: 0.2 } } },
  yAxis: { type: 'log', name: t('cost.perHour'), splitLine: { lineStyle: { opacity: 0.2 } } },
  // One series per currency: values in different currencies are never mixed on one scale silently.
  series: scatterCurrencies.value.map((currency) => ({
    type: 'scatter',
    name: currency,
    symbolSize: 9,
    data: scatterItems.value
      .filter((i) => (metric(i) as { value: { currency: string } }).value.currency === currency)
      .map((i) => [Math.max(0.1, hoursOf(i.playtimeMinutes)), Math.max(0.001, (metric(i) as { value: { amount: number } }).value.amount), i.name, currency]),
  })),
}));
</script>

<template>
  <SteamRequired>
    <div class="flex flex-col gap-6">
      <div>
        <h1 class="text-2xl font-semibold">{{ $t('analytics.title') }}</h1>
        <DataAsOf :at="playtime.meta.value?.dataAsOf" />
      </div>
      <ErrorState v-if="playtime.error.value" :error="playtime.error.value" @retry="playtime.reload" />
      <template v-else>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard :label="$t('stats.totalPlaytime')" icon="clock" :loading="playtime.loading.value" :value="p ? f.hours(p.totalPlaytimeMinutes) : null" :hint="$t('analytics.formula')" />
          <StatCard :label="$t('analytics.played')" icon="gamepad" :loading="playtime.loading.value" :value="p ? f.number(p.playedGames) : null" :hint="p ? $t('analytics.unplayedCount', { n: p.unplayedGames }) : undefined" />
          <StatCard :label="$t('analytics.avgPerPlayed')" icon="chart" :loading="playtime.loading.value" :unavailable="p?.averagePlaytimePerPlayedGameMinutes == null" :value="f.hours(p?.averagePlaytimePerPlayedGameMinutes)" />
          <StatCard :label="$t('analytics.mostPlayed')" icon="trophy" :loading="playtime.loading.value" :unavailable="!p?.mostPlayed" :value="p?.mostPlayed?.name" :hint="p?.mostPlayed ? `${f.hours(p.mostPlayed.playtimeMinutes)} · ${f.percent(p.mostPlayed.share)}` : undefined" />
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <section class="card lg:col-span-2">
            <h2 class="section-title mb-2">{{ $t('analytics.top10') }}</h2>
            <p v-if="!playtime.loading.value && !p?.top10.length" class="py-10 text-center text-sm text-muted">{{ $t('common.noData') }}</p>
            <BaseChart v-else :option="top10Option" :loading="playtime.loading.value" height="360px" :label="$t('analytics.top10')" />
          </section>
          <section class="card">
            <h2 class="section-title mb-2">{{ $t('analytics.playedVsUnplayed') }}</h2>
            <BaseChart :option="playedOption" :loading="playtime.loading.value" height="360px" :label="$t('analytics.playedVsUnplayed')" />
          </section>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <section class="card">
            <h2 class="section-title mb-2">{{ $t('analytics.distribution') }}</h2>
            <BaseChart :option="distributionOption" :loading="playtime.loading.value" height="300px" :label="$t('analytics.distribution')" />
          </section>
          <section class="card">
            <div class="mb-2 flex items-center justify-between gap-2">
              <h2 class="section-title">{{ $t('analytics.trend') }}</h2>
              <select v-model="trendMode" class="input w-auto" :aria-label="$t('analytics.trendMode')">
                <option value="daily">{{ $t('analytics.daily') }}</option>
                <option value="monthly">{{ $t('analytics.monthly') }}</option>
              </select>
            </div>
            <p class="mb-2 text-xs text-muted">
              {{ p?.trend.trackingStartedAt ? $t('analytics.trackingSince', { date: f.date(p.trend.trackingStartedAt) }) : $t('analytics.trackingNotStarted') }}
            </p>
            <p v-if="!playtime.loading.value && trendPoints.length === 0" class="rounded-lg bg-surface-2 p-6 text-center text-sm text-muted">{{ $t('analytics.trendEmpty') }}</p>
            <BaseChart v-else :option="trendOption" :loading="playtime.loading.value" height="260px" :label="$t('analytics.trend')" />
          </section>
        </div>
      </template>

      <section class="card flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="section-title">{{ $t('analytics.costEfficiency') }}</h2>
          <div class="flex gap-1" role="group" :aria-label="$t('analytics.basis')">
            <button type="button" class="btn px-3 py-1" :class="basis === 'estimated' ? 'btn-secondary' : 'btn-ghost'" :aria-pressed="basis === 'estimated'" @click="basis = 'estimated'">{{ $t('cost.estimated') }}</button>
            <button type="button" class="btn px-3 py-1" :class="basis === 'actual' ? 'btn-secondary' : 'btn-ghost'" :aria-pressed="basis === 'actual'" @click="basis = 'actual'">{{ $t('cost.actual') }}</button>
          </div>
        </div>
        <p class="text-xs text-muted">{{ basis === 'estimated' ? $t('cost.estimatedHint') : $t('cost.actualHint') }}</p>
        <ErrorState v-if="cost.error.value" :error="cost.error.value" compact @retry="cost.reload" />
        <template v-else>
          <div v-if="cost.data.value" class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>{{ $t('cost.average') }}: <strong>{{ (basis === 'actual' ? cost.data.value.averages.actual : cost.data.value.averages.estimated).map((m) => f.money(m, 2)).join(' · ') || $t('common.unavailable') }}</strong></span>
            <span class="text-muted">{{ $t('cost.notPlayedCount', { n: cost.data.value.notPlayedCount }) }}</span>
            <span class="text-muted">{{ $t('cost.noPriceCount', { n: cost.data.value.noPriceCount }) }}</span>
          </div>
          <p v-if="!cost.loading.value && scatterItems.length === 0" class="rounded-lg bg-surface-2 p-6 text-center text-sm text-muted">{{ basis === 'actual' ? $t('cost.noActualData') : $t('common.noData') }}</p>
          <BaseChart v-else :option="scatterOption" :loading="cost.loading.value" height="360px" :label="$t('analytics.costEfficiency')" />
          <div v-if="cost.data.value && scatterItems.length" class="grid gap-4 md:grid-cols-2">
            <div v-for="list in (['lowest', 'highest'] as const)" :key="list">
              <h3 class="mb-2 text-sm font-semibold">{{ $t(`cost.${list}`) }}</h3>
              <ol class="flex flex-col divide-y divide-line rounded-lg border border-line text-sm">
                <li v-for="i in cost.data.value[list]" :key="i.appId" class="flex items-center justify-between gap-2 px-3 py-2">
                  <RouterLink :to="{ name: 'game', params: { appid: i.appId } }" class="truncate hover:text-accent">{{ i.name }}</RouterLink>
                  <span class="shrink-0 text-right">
                    <span class="font-medium">{{ f.costPerHour(metric(i)) }}</span>
                    <span class="block text-xs text-muted">{{ f.hours(i.playtimeMinutes) }} · {{ f.money(basis === 'actual' ? i.actualPrice : i.estimatedPrice) }}</span>
                  </span>
                </li>
              </ol>
            </div>
          </div>
        </template>
      </section>
    </div>
  </SteamRequired>
</template>
