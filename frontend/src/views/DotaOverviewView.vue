<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DotaOverviewDto, DotaQueue } from '@steam-analytics/shared';
import { api } from '@/services/api';
import { useApi } from '@/composables/useAsync';
import { useFormat } from '@/composables/useFormat';
import { useDotaLabels } from '@/composables/useDotaLabels';
import BaseChart from '@/components/charts/BaseChart.vue';
import type { ChartOption } from '@/components/charts/types';
import DotaIcon from '@/components/dota/DotaIcon.vue';
import DotaInsightList from '@/components/dota/DotaInsightList.vue';
import DotaWinRateBars from '@/components/dota/DotaWinRateBars.vue';
import StatCard from '@/components/ui/StatCard.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';

const { t } = useI18n();
const f = useFormat();
const labels = useDotaLabels();

const window = ref<'all' | '500' | '100' | '20'>('all');
const queue = ref<DotaQueue>('all');
const res = useApi(() => api.get<DotaOverviewDto>('/dota/overview', { window: window.value, queue: queue.value }), [window, queue]);

const d = computed(() => res.data.value);
const noHistory = computed(() => d.value?.matchesTotal === 0);
const heroRef = (id: number) => d.value?.heroRefs.find((h) => h.id === id);
const TOP_HEROES = 15;
const topHeroes = computed(() => d.value?.heroes.slice(0, TOP_HEROES) ?? []);

const streakValue = computed(() => {
  const c = d.value?.streaks.current;
  if (!c?.result) return null;
  return t(c.result === 'win' ? 'dota.streakWins' : 'dota.streakLosses', { n: c.count });
});

const rollingOption = computed<ChartOption>(() => {
  const points = d.value?.rollingWinRate ?? [];
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v}%` },
    xAxis: { type: 'category', data: points.map((p) => f.date(p.at)), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { opacity: 0.2 } } },
    series: [{
      type: 'line',
      name: t('dota.winRate'),
      showSymbol: false,
      data: points.map((p) => p.winRate),
    }],
  };
});

const monthlyOption = computed<ChartOption>(() => {
  const months = d.value?.monthly ?? [];
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    xAxis: { type: 'category', data: months.map((m) => m.month), axisLabel: { hideOverlap: true } },
    yAxis: [
      { type: 'value', minInterval: 1, splitLine: { lineStyle: { opacity: 0.2 } } },
      { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' }, splitLine: { show: false } },
    ],
    dataZoom: months.length > 36 ? [{ type: 'inside', startValue: months.length - 36 }] : [],
    series: [
      { type: 'bar', name: t('dota.matches'), data: months.map((m) => m.games), barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0] } },
      { type: 'line', name: t('dota.winRate'), yAxisIndex: 1, showSymbol: false, data: months.map((m) => m.winRate) },
    ],
  };
});

const modeRows = computed(() => (d.value?.byGameMode ?? []).map((m) => ({ label: labels.gameMode(m.gameMode), games: m.games, winRate: m.winRate })));
const durationRows = computed(() => (d.value?.byDuration ?? []).filter((b) => b.games > 0).map((b) => ({ label: t(`dota.duration.${b.bucket}`), games: b.games, winRate: b.winRate })));
const splitRows = computed(() => {
  if (!d.value) return [];
  const { bySide, byParty } = d.value;
  return [
    { label: t('dota.radiant'), games: bySide.radiant.games, winRate: bySide.radiant.winRate },
    { label: t('dota.dire'), games: bySide.dire.games, winRate: bySide.dire.winRate },
    { label: t('dota.solo'), games: byParty.solo.games, winRate: byParty.solo.winRate },
    { label: t('dota.party'), games: byParty.party.games, winRate: byParty.party.winRate },
  ].filter((r) => r.games > 0);
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <ErrorState v-if="res.error.value" :error="res.error.value" @retry="res.reload" />
    <EmptyState v-else-if="noHistory" icon="swords" :title="$t('dota.emptyTitle')" :description="$t('dota.emptyDescription')" />
    <template v-else>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-xs text-muted">{{ res.meta.value?.dataAsOf ? $t('dota.dataAsOf', { time: f.relative(res.meta.value.dataAsOf) }) : '' }}</p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <select v-model="queue" class="input sm:w-44" :aria-label="$t('dota.queue')">
            <option value="all">{{ $t('dota.queueAll') }}</option>
            <option value="ranked">{{ $t('dota.queueRanked') }}</option>
            <option value="unranked">{{ $t('dota.queueUnranked') }}</option>
            <option value="turbo">{{ $t('dota.queueTurbo') }}</option>
          </select>
          <select v-model="window" class="input sm:w-44" :aria-label="$t('dota.window')">
            <option value="all">{{ $t('dota.windowAll') }}</option>
            <option value="500">{{ $t('dota.windowLast', { n: 500 }) }}</option>
            <option value="100">{{ $t('dota.windowLast', { n: 100 }) }}</option>
            <option value="20">{{ $t('dota.windowLast', { n: 20 }) }}</option>
          </select>
        </div>
      </div>

      <p v-if="d?.truncated" class="rounded-lg bg-warning/10 p-3 text-sm">{{ $t('dota.truncated', { n: f.number(d.matchesTotal) }) }}</p>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard :label="$t('dota.matches')" icon="swords" :loading="res.loading.value" :value="d ? f.number(d.totals.games) : null" :hint="d ? $t('dota.winsLosses', { w: f.number(d.totals.wins), l: f.number(d.totals.losses) }) : undefined" />
        <StatCard :label="$t('dota.winRate')" icon="trophy" :loading="res.loading.value" :unavailable="d?.totals.winRate == null" :value="f.percent(d?.totals.winRate)" />
        <StatCard :label="$t('dota.kda')" icon="chart" :loading="res.loading.value" :unavailable="d?.totals.kda == null" :value="d?.totals.kda != null ? f.number(d.totals.kda, 2) : null" :hint="d?.totals.avgKills != null ? `${f.number(d.totals.avgKills, 1)} / ${f.number(d.totals.avgDeaths!, 1)} / ${f.number(d.totals.avgAssists!, 1)}` : undefined" />
        <StatCard :label="$t('dota.rank.label')" icon="tag" :loading="res.loading.value" :value="labels.rank(d?.player.rankTier)" :hint="d?.player.leaderboardRank ? $t('dota.leaderboard', { n: d.player.leaderboardRank }) : undefined" />
        <StatCard :label="$t('dota.avgGpmXpm')" icon="wallet" :loading="res.loading.value" :unavailable="d?.totals.avgGpm == null" :value="d?.totals.avgGpm != null ? `${f.number(d.totals.avgGpm)} / ${f.number(d.totals.avgXpm ?? 0)}` : null" />
        <StatCard :label="$t('dota.avgDuration')" icon="clock" :loading="res.loading.value" :unavailable="d?.totals.avgDurationSeconds == null" :value="f.clock(d?.totals.avgDurationSeconds)" :hint="d ? $t('dota.totalPlayed', { time: f.hours(d.totals.totalDurationSeconds / 60) }) : undefined" />
        <StatCard :label="$t('dota.currentStreak')" icon="layers" :loading="res.loading.value" :unavailable="!streakValue" :value="streakValue" :hint="d ? $t('dota.longestStreaks', { w: d.streaks.longestWin, l: d.streaks.longestLoss }) : undefined" />
        <StatCard :label="$t('dota.heroesPlayed')" icon="grid" :loading="res.loading.value" :value="d ? f.number(d.heroes.length) : null" />
      </div>

      <section v-if="d && d.insights.length > 0" class="card flex flex-col gap-3">
        <h2 class="section-title">{{ $t('dota.insightsTitle') }}</h2>
        <DotaInsightList :insights="d.insights" />
      </section>

      <section v-if="d && d.recentForm.length > 0" class="card flex flex-col gap-3">
        <h2 class="section-title">{{ $t('dota.recentForm') }}</h2>
        <ul class="flex flex-wrap gap-1">
          <li v-for="m in d.recentForm" :key="m.matchId">
            <RouterLink
              :to="{ name: 'dota-match', params: { matchid: m.matchId } }"
              class="flex h-7 w-7 items-center justify-center rounded text-xs font-semibold"
              :class="m.won ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'"
              :aria-label="m.won ? $t('dota.win') : $t('dota.loss')"
            >
              {{ m.won ? $t('dota.winShort') : $t('dota.lossShort') }}
            </RouterLink>
          </li>
        </ul>
      </section>

      <div class="grid gap-6 xl:grid-cols-2">
        <section class="card flex flex-col gap-3">
          <h2 class="section-title">{{ $t('dota.rollingTitle') }}</h2>
          <p v-if="d && d.rollingWinRate.length === 0" class="py-10 text-center text-sm text-muted">{{ $t('dota.rollingEmpty') }}</p>
          <BaseChart v-else :option="rollingOption" :loading="res.loading.value" height="280px" :label="$t('dota.rollingTitle')" />
        </section>
        <section class="card flex flex-col gap-3">
          <h2 class="section-title">{{ $t('dota.monthlyTitle') }}</h2>
          <BaseChart :option="monthlyOption" :loading="res.loading.value" height="280px" :label="$t('dota.monthlyTitle')" />
        </section>
      </div>

      <section v-if="d" class="card flex flex-col gap-3">
        <h2 class="section-title">{{ $t('dota.heroesTitle', { n: Math.min(TOP_HEROES, d.heroes.length) }) }}</h2>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-sm">
            <thead class="text-xs text-muted">
              <tr>
                <th class="py-2 pr-3 font-medium">{{ $t('dota.hero') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ $t('dota.matches') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ $t('dota.winRate') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ $t('dota.kda') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ $t('dota.gpm') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ $t('dota.xpm') }}</th>
                <th class="pl-3 py-2 text-right font-medium">{{ $t('dota.lastPlayed') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in topHeroes" :key="h.heroId" class="border-t border-line">
                <td class="py-2 pr-3">
                  <RouterLink :to="{ name: 'dota-matches', query: { heroId: h.heroId } }" class="flex items-center gap-2 hover:text-accent">
                    <DotaIcon :src="heroRef(h.heroId)?.imageUrl ?? null" name="" img-class="h-6 w-10" />
                    {{ heroRef(h.heroId)?.name }}
                  </RouterLink>
                </td>
                <td class="px-3 py-2 text-right">{{ f.number(h.games) }}</td>
                <td class="px-3 py-2 text-right" :class="(h.winRate ?? 0) >= 50 ? 'text-success' : 'text-danger'">{{ f.percent(h.winRate) }}</td>
                <td class="px-3 py-2 text-right">{{ h.kda === null ? '—' : f.number(h.kda, 2) }}</td>
                <td class="px-3 py-2 text-right">{{ h.avgGpm === null ? '—' : f.number(h.avgGpm) }}</td>
                <td class="px-3 py-2 text-right">{{ h.avgXpm === null ? '—' : f.number(h.avgXpm) }}</td>
                <td class="pl-3 py-2 text-right text-muted">{{ f.date(h.lastPlayedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div v-if="d" class="grid gap-6 lg:grid-cols-3">
        <section class="card flex flex-col gap-3">
          <h2 class="section-title">{{ $t('dota.byMode') }}</h2>
          <DotaWinRateBars :rows="modeRows" />
        </section>
        <section class="card flex flex-col gap-3">
          <h2 class="section-title">{{ $t('dota.byDuration') }}</h2>
          <DotaWinRateBars :rows="durationRows" />
        </section>
        <section class="card flex flex-col gap-3">
          <h2 class="section-title">{{ $t('dota.bySplit') }}</h2>
          <DotaWinRateBars :rows="splitRows" />
        </section>
      </div>
    </template>
  </div>
</template>
