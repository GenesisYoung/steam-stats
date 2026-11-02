<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DotaComparisonMetric, DotaMatchDetailDto, DotaMatchPlayerDto } from '@steam-analytics/shared';
import { api } from '@/services/api';
import { useApi } from '@/composables/useAsync';
import { useFormat } from '@/composables/useFormat';
import { useDotaLabels } from '@/composables/useDotaLabels';
import BaseChart from '@/components/charts/BaseChart.vue';
import type { ChartOption } from '@/components/charts/types';
import DotaIcon from '@/components/dota/DotaIcon.vue';
import DotaInsightList from '@/components/dota/DotaInsightList.vue';
import StatCard from '@/components/ui/StatCard.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';
import AppIcon from '@/components/ui/AppIcon.vue';

const props = defineProps<{ matchId: string }>();
const { t } = useI18n();
const f = useFormat();
const labels = useDotaLabels();

const res = useApi(() => api.get<DotaMatchDetailDto>(`/dota/matches/${props.matchId}`), [() => props.matchId]);
const m = computed(() => res.data.value);
const perf = computed(() => m.value?.performance ?? null);
const you = computed(() => m.value?.players.find((p) => p.isYou) ?? null);

const teams = computed(() => {
  const players = m.value?.players ?? [];
  return [
    { key: 'radiant', label: t('dota.radiant'), won: m.value?.radiantWin === true, score: m.value?.radiantScore, players: players.filter((p) => p.isRadiant) },
    { key: 'dire', label: t('dota.dire'), won: m.value?.radiantWin === false, score: m.value?.direScore, players: players.filter((p) => !p.isRadiant) },
  ];
});

const parseState = ref<'idle' | 'sending' | 'sent'>('idle');
const parseError = ref<unknown>(null);
watch(() => props.matchId, () => { parseState.value = 'idle'; parseError.value = null; });
async function requestParse() {
  parseState.value = 'sending';
  parseError.value = null;
  try {
    await api.post(`/dota/matches/${props.matchId}/parse`);
    parseState.value = 'sent';
  } catch (err) {
    parseState.value = 'idle';
    parseError.value = err;
  }
}

const minutes = (n: number) => Array.from({ length: n }, (_, i) => String(i));

const advantageOption = computed<ChartOption>(() => {
  const gold = m.value?.radiantGoldAdvantage ?? [];
  const xp = m.value?.radiantXpAdvantage ?? [];
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v) => f.number(Number(v)) },
    legend: { top: 0 },
    xAxis: { type: 'category', name: t('dota.minutes'), nameLocation: 'middle', nameGap: 26, data: minutes(Math.max(gold.length, xp.length)), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', splitLine: { lineStyle: { opacity: 0.2 } } },
    series: [
      { type: 'line', name: t('dota.goldLead'), showSymbol: false, areaStyle: { opacity: 0.12 }, data: gold },
      { type: 'line', name: t('dota.xpLead'), showSymbol: false, data: xp },
    ],
  };
});

const timelineOption = computed<ChartOption>(() => {
  const gold = perf.value?.goldTimeline ?? [];
  const xp = perf.value?.xpTimeline ?? [];
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v) => f.number(Number(v)) },
    legend: { top: 0 },
    xAxis: { type: 'category', name: t('dota.minutes'), nameLocation: 'middle', nameGap: 26, data: minutes(Math.max(gold.length, xp.length)), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', splitLine: { lineStyle: { opacity: 0.2 } } },
    series: [
      { type: 'line', name: t('dota.gold'), showSymbol: false, data: gold },
      { type: 'line', name: t('dota.xp'), showSymbol: false, data: xp },
    ],
  };
});

const METRIC_DIGITS: Record<DotaComparisonMetric, number> = { kda: 2, gpm: 0, xpm: 0, lastHitsPerMinute: 2, heroDamagePerMinute: 0 };
const metricValue = (metric: DotaComparisonMetric, v: number | null) => (v === null ? '—' : f.number(v, METRIC_DIGITS[metric]));
/** Colour relative to the player's own average on this hero. */
const metricTone = (value: number | null, average: number | null) => {
  if (value === null || average === null || value === average) return '';
  return value > average ? 'text-success' : 'text-danger';
};
const percentileTone = (p: number) => (p >= 70 ? 'bg-success' : p >= 30 ? 'bg-accent' : 'bg-danger');

const detailRows = computed(() => {
  const d = perf.value?.detail;
  if (!d) return [];
  return [
    { label: t('dota.detail.lane'), value: d.laneEfficiencyPct === null ? null : `${d.laneEfficiencyPct}%` },
    { label: t('dota.detail.observers'), value: d.observersPlaced },
    { label: t('dota.detail.sentries'), value: d.sentriesPlaced },
    { label: t('dota.detail.stuns'), value: d.stunSeconds === null ? null : `${f.number(d.stunSeconds, 1)} s` },
    { label: t('dota.detail.stacks'), value: d.campsStacked },
    { label: t('dota.detail.runes'), value: d.runePickups },
  ].filter((r) => r.value !== null);
});

const stat = (v: number | null) => (v === null ? '—' : f.number(v));
const playerName = (p: DotaMatchPlayerDto) => p.name ?? t('dota.anonymous');
</script>

<template>
  <div class="flex flex-col gap-6">
    <RouterLink :to="{ name: 'dota-matches' }" class="flex w-fit items-center gap-1 text-sm text-muted hover:text-fg">
      <AppIcon name="chevronLeft" :size="16" /> {{ $t('dota.backToMatches') }}
    </RouterLink>

    <ErrorState v-if="res.error.value" :error="res.error.value" @retry="res.reload" />
    <SkeletonBlock v-else-if="res.loading.value && !m" class="h-96" />
    <template v-else-if="m">
      <section class="card flex flex-col gap-4 sm:flex-row sm:items-center">
        <DotaIcon v-if="you" :src="you.hero.imageUrl" :name="you.hero.name" img-class="h-20 w-36 shrink-0" />
        <div class="flex flex-1 flex-col gap-1">
          <h2 class="text-xl font-semibold">
            <template v-if="perf">
              <span :class="perf.won === null ? 'text-muted' : perf.won ? 'text-success' : 'text-danger'">{{ perf.won === null ? $t('dota.noResult') : perf.won ? $t('dota.win') : $t('dota.loss') }}</span>
              · {{ you?.hero.name }}
            </template>
            <template v-else>{{ m.radiantWin === null ? $t('dota.noResult') : m.radiantWin ? $t('dota.radiantWon') : $t('dota.direWon') }}</template>
          </h2>
          <p class="text-sm text-muted">
            {{ labels.gameMode(m.gameMode) }}<span v-if="m.ranked"> · {{ $t('dota.ranked') }}</span>
            · {{ f.clock(m.durationSeconds) }} · {{ f.date(m.startTime, true) }}
          </p>
          <p class="text-xs text-muted">{{ $t('dota.matchId', { id: m.matchId }) }}</p>
        </div>
        <div class="text-center text-2xl font-semibold tabular-nums">
          <span class="text-success">{{ m.radiantScore ?? '—' }}</span>
          <span class="mx-2 text-muted">:</span>
          <span class="text-danger">{{ m.direScore ?? '—' }}</span>
          <p class="text-xs font-normal text-muted">{{ $t('dota.radiant') }} : {{ $t('dota.dire') }}</p>
        </div>
      </section>

      <p v-if="!perf" class="rounded-lg bg-accent/10 p-3 text-sm">{{ $t('dota.notInMatch') }}</p>

      <div v-if="!m.parsed" class="flex flex-col gap-3 rounded-lg border border-line p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>{{ parseState === 'sent' ? $t('dota.parseSent') : $t('dota.notParsed') }}</p>
        <button v-if="parseState === 'sent'" type="button" class="btn btn-secondary shrink-0" @click="res.reload">
          <AppIcon name="refresh" :size="16" /> {{ $t('dota.checkAgain') }}
        </button>
        <button v-else type="button" class="btn btn-primary shrink-0" :disabled="parseState === 'sending'" @click="requestParse">{{ $t('dota.requestParse') }}</button>
      </div>
      <ErrorState v-if="parseError" compact :error="parseError" @retry="requestParse" />

      <template v-if="perf && you">
        <section v-if="perf.highlights.length > 0" class="card flex flex-col gap-3">
          <h2 class="section-title">{{ $t('dota.highlightsTitle') }}</h2>
          <DotaInsightList :insights="perf.highlights" />
        </section>

        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard :label="$t('dota.kdaLine')" icon="swords" :value="`${you.kills} / ${you.deaths} / ${you.assists}`" :hint="$t('dota.kdaRatio', { value: f.number(perf.kda, 2) })" />
          <StatCard :label="$t('dota.killParticipation')" icon="layers" :unavailable="perf.teamShare.killParticipation === null" :value="f.percent(perf.teamShare.killParticipation)" />
          <StatCard :label="$t('dota.damageShare')" icon="chart" :unavailable="perf.teamShare.heroDamage === null" :value="f.percent(perf.teamShare.heroDamage)" :hint="perf.teamRank.heroDamage ? $t('dota.teamRank', { n: perf.teamRank.heroDamage }) : undefined" />
          <StatCard :label="$t('dota.netWorthShare')" icon="wallet" :unavailable="perf.teamShare.netWorth === null" :value="f.percent(perf.teamShare.netWorth)" :hint="perf.teamRank.netWorth ? $t('dota.teamRank', { n: perf.teamRank.netWorth }) : undefined" />
        </div>

        <div class="grid gap-6 xl:grid-cols-2">
          <section class="card flex flex-col gap-3">
            <div>
              <h2 class="section-title">{{ $t('dota.comparisonTitle') }}</h2>
              <p class="text-xs text-muted">{{ $t('dota.comparisonHint', { hero: you.hero.name, heroGames: perf.heroGames, games: perf.overallGames }) }}</p>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs text-muted">
                  <tr>
                    <th class="py-2 pr-3 font-medium">{{ $t('dota.metric') }}</th>
                    <th class="px-3 py-2 text-right font-medium">{{ $t('dota.thisMatch') }}</th>
                    <th class="px-3 py-2 text-right font-medium">{{ $t('dota.heroAverage') }}</th>
                    <th class="pl-3 py-2 text-right font-medium">{{ $t('dota.overallAverage') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in perf.comparison" :key="c.metric" class="border-t border-line">
                    <td class="py-2 pr-3">{{ $t(`dota.metrics.${c.metric}`) }}</td>
                    <td class="px-3 py-2 text-right font-medium" :class="metricTone(c.value, c.heroAverage ?? c.overallAverage)">{{ metricValue(c.metric, c.value) }}</td>
                    <td class="px-3 py-2 text-right text-muted">{{ metricValue(c.metric, c.heroAverage) }}</td>
                    <td class="pl-3 py-2 text-right text-muted">{{ metricValue(c.metric, c.overallAverage) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section v-if="perf.benchmarks.length > 0" class="card flex flex-col gap-3">
            <div>
              <h2 class="section-title">{{ $t('dota.benchmarksTitle') }}</h2>
              <p class="text-xs text-muted">{{ $t('dota.benchmarksHint', { hero: you.hero.name }) }}</p>
            </div>
            <ul class="flex flex-col gap-3">
              <li v-for="b in perf.benchmarks" :key="b.key" class="text-sm">
                <div class="mb-1 flex justify-between gap-2">
                  <span>{{ labels.benchmark(b.key) }}</span>
                  <span class="text-muted">{{ $t('dota.percentile', { n: b.percentile }) }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div class="h-full rounded-full" :class="percentileTone(b.percentile)" :style="{ width: `${b.percentile}%` }" />
                </div>
              </li>
            </ul>
          </section>
        </div>

        <div v-if="perf.itemTimings.length > 0 || detailRows.length > 0" class="grid gap-6 xl:grid-cols-2">
          <section v-if="perf.itemTimings.length > 0" class="card flex flex-col gap-3">
            <h2 class="section-title">{{ $t('dota.itemTimings') }}</h2>
            <ul class="flex flex-wrap gap-3">
              <li v-for="i in perf.itemTimings" :key="i.item.id" class="flex w-14 flex-col items-center gap-1 text-xs">
                <DotaIcon :src="i.item.imageUrl" :name="i.item.name" img-class="h-9 w-12" />
                <span class="tabular-nums text-muted">{{ f.clock(i.timeSeconds) }}</span>
              </li>
            </ul>
          </section>
          <section v-if="detailRows.length > 0" class="card flex flex-col gap-3">
            <h2 class="section-title">{{ $t('dota.detail.title') }}</h2>
            <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div v-for="r in detailRows" :key="r.label">
                <dt class="text-xs text-muted">{{ r.label }}</dt>
                <dd class="text-lg font-semibold">{{ r.value }}</dd>
              </div>
            </dl>
          </section>
        </div>
      </template>

      <div v-if="m.radiantGoldAdvantage.length > 0" class="grid gap-6" :class="perf && perf.goldTimeline.length > 0 ? 'xl:grid-cols-2' : ''">
        <section class="card flex flex-col gap-3">
          <div>
            <h2 class="section-title">{{ $t('dota.advantageTitle') }}</h2>
            <p class="text-xs text-muted">{{ $t('dota.advantageHint') }}</p>
          </div>
          <BaseChart :option="advantageOption" height="280px" :label="$t('dota.advantageTitle')" />
        </section>
        <section v-if="perf && perf.goldTimeline.length > 0" class="card flex flex-col gap-3">
          <h2 class="section-title">{{ $t('dota.yourTimeline') }}</h2>
          <BaseChart :option="timelineOption" height="280px" :label="$t('dota.yourTimeline')" />
        </section>
      </div>

      <section v-for="team in teams" :key="team.key" class="card flex flex-col gap-3">
        <h2 class="section-title flex items-center gap-2">
          {{ team.label }}
          <span v-if="team.won" class="text-sm font-medium text-success">{{ $t('dota.winner') }}</span>
        </h2>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[920px] text-left text-sm">
            <thead class="text-xs text-muted">
              <tr>
                <th class="py-2 pr-3 font-medium">{{ $t('dota.player') }}</th>
                <th class="px-2 py-2 text-right font-medium">{{ $t('dota.levelShort') }}</th>
                <th class="px-2 py-2 text-right font-medium">{{ $t('dota.kdaLine') }}</th>
                <th class="px-2 py-2 text-right font-medium">{{ $t('dota.lhDn') }}</th>
                <th class="px-2 py-2 text-right font-medium">{{ $t('dota.gpm') }}</th>
                <th class="px-2 py-2 text-right font-medium">{{ $t('dota.xpm') }}</th>
                <th class="px-2 py-2 text-right font-medium">{{ $t('dota.damageShort') }}</th>
                <th class="px-2 py-2 text-right font-medium">{{ $t('dota.towerShort') }}</th>
                <th class="px-2 py-2 text-right font-medium">{{ $t('dota.netWorth') }}</th>
                <th class="pl-3 py-2 font-medium">{{ $t('dota.items') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in team.players" :key="`${p.hero.id}-${p.accountId}`" class="border-t border-line" :class="p.isYou ? 'bg-accent/10' : ''">
                <td class="py-2 pr-3">
                  <div class="flex items-center gap-2">
                    <DotaIcon :src="p.hero.imageUrl" :name="p.hero.name" img-class="h-7 w-12 shrink-0" />
                    <div class="min-w-0">
                      <p class="max-w-40 truncate font-medium">{{ p.isYou ? $t('dota.you') : playerName(p) }}</p>
                      <p class="truncate text-xs text-muted">{{ p.hero.name }}</p>
                    </div>
                  </div>
                </td>
                <td class="px-2 py-2 text-right">{{ p.level ?? '—' }}</td>
                <td class="px-2 py-2 text-right whitespace-nowrap">{{ p.kills }} / {{ p.deaths }} / {{ p.assists }}</td>
                <td class="px-2 py-2 text-right whitespace-nowrap">{{ stat(p.lastHits) }} / {{ stat(p.denies) }}</td>
                <td class="px-2 py-2 text-right">{{ stat(p.gpm) }}</td>
                <td class="px-2 py-2 text-right">{{ stat(p.xpm) }}</td>
                <td class="px-2 py-2 text-right">{{ stat(p.heroDamage) }}</td>
                <td class="px-2 py-2 text-right">{{ stat(p.towerDamage) }}</td>
                <td class="px-2 py-2 text-right">{{ stat(p.netWorth) }}</td>
                <td class="pl-3 py-2">
                  <div class="flex items-center gap-0.5">
                    <DotaIcon v-for="(item, i) in p.items" :key="i" :src="item.imageUrl" :name="item.name" img-class="h-6 w-8" />
                    <DotaIcon v-if="p.neutralItem" :src="p.neutralItem.imageUrl" :name="p.neutralItem.name" img-class="ml-1 h-6 w-6 rounded-full" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
