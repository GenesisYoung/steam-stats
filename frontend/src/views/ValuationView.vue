<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LibraryValueDto, PurchaseBundleRef, PurchaseDto } from '@steam-analytics/shared';
import { api } from '@/services/api';
import { useApi } from '@/composables/useAsync';
import { useFormat } from '@/composables/useFormat';
import { useSteamStore } from '@/stores/steam';
import SteamRequired from '@/components/steam/SteamRequired.vue';
import BaseChart from '@/components/charts/BaseChart.vue';
import type { ChartOption } from '@/components/charts/types';
import StatCard from '@/components/ui/StatCard.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';
import DataAsOf from '@/components/ui/DataAsOf.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import BundleEditor from '@/components/steam/BundleEditor.vue';

const { t } = useI18n();
const f = useFormat();
const steam = useSteamStore();
const value = useApi(() => api.get<LibraryValueDto>('/analytics/library-value'), [() => steam.dataRevision]);
const purchases = useApi(() => api.get<PurchaseDto[]>('/purchases'), [() => steam.dataRevision]);

const est = computed(() => value.data.value?.estimated);

/** Single purchases and bundles (games bought together), newest first as returned by the API. */
const purchaseGroups = computed(() => {
  const groups: { key: string; bundle: PurchaseBundleRef | null; items: PurchaseDto[] }[] = [];
  const byBundle = new Map<string, (typeof groups)[number]>();
  for (const p of purchases.data.value ?? []) {
    if (!p.bundle) {
      groups.push({ key: `p${p.appId}`, bundle: null, items: [p] });
      continue;
    }
    let g = byBundle.get(p.bundle.id);
    if (!g) {
      g = { key: p.bundle.id, bundle: p.bundle, items: [] };
      byBundle.set(p.bundle.id, g);
      groups.push(g);
    }
    g.items.push(p);
  }
  return groups;
});

const bundleOpen = ref(false);
const bundleId = ref<string | null>(null);
function openBundle(id: string | null) {
  bundleId.value = id;
  bundleOpen.value = true;
}
function onBundleSaved() {
  bundleOpen.value = false;
  steam.dataRevision += 1;
}
const coverageOption = computed<ChartOption>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: 0 },
  series: [{
    type: 'pie',
    radius: ['45%', '70%'],
    label: { show: false },
    data: est.value
      ? [
          { name: t('valuation.priced'), value: est.value.pricedGames },
          { name: t('valuation.free'), value: est.value.freeGames },
          { name: t('valuation.unavailable'), value: est.value.unavailableGames },
          { name: t('valuation.unknown'), value: est.value.unknownGames },
          { name: t('valuation.excluded'), value: est.value.excludedNonGames },
        ].filter((d) => d.value > 0)
      : [],
  }],
}));
</script>

<template>
  <SteamRequired>
    <div class="flex flex-col gap-6">
      <div>
        <h1 class="text-2xl font-semibold">{{ $t('valuation.title') }}</h1>
        <DataAsOf :at="value.meta.value?.dataAsOf" />
      </div>
      <ErrorState v-if="value.error.value" :error="value.error.value" @retry="value.reload" />
      <template v-else>
        <section class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="section-title">{{ $t('valuation.modelA') }}</h2>
            <span class="badge bg-accent/15 text-accent">{{ $t('valuation.estimate') }}</span>
          </div>
          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard :label="$t('stats.estimatedValue')" icon="wallet" :loading="value.loading.value" :unavailable="!est?.totals.length" :value="f.totals(est?.totals)" :hint="est ? $t('price.assumption', { region: est.region.toUpperCase() }) : undefined" />
            <StatCard :label="$t('valuation.priced')" icon="tag" :loading="value.loading.value" :value="est ? f.number(est.pricedGames) : null" :hint="est ? $t('valuation.freeCount', { n: est.freeGames }) : undefined" />
            <StatCard :label="$t('valuation.unpriced')" icon="alert" :loading="value.loading.value" :value="est ? f.number(est.unavailableGames + est.unknownGames) : null" :hint="est ? $t('valuation.unpricedHint', { unavailable: est.unavailableGames, unknown: est.unknownGames }) : undefined" />
            <StatCard :label="$t('valuation.lastUpdate')" icon="clock" :loading="value.loading.value" :unavailable="!est?.lastPriceUpdateAt" :value="f.relative(est?.lastPriceUpdateAt)" :hint="est?.lastPriceUpdateAt ? f.date(est.lastPriceUpdateAt, true) : undefined" />
          </div>
          <div class="grid gap-4 lg:grid-cols-3">
            <div class="card text-sm text-muted lg:col-span-2">
              <h3 class="mb-2 font-semibold text-fg">{{ $t('valuation.methodTitle') }}</h3>
              <ul class="list-disc space-y-1 pl-5">
                <li>{{ $t('valuation.method1') }}</li>
                <li>{{ $t('valuation.method2') }}</li>
                <li>{{ $t('valuation.method3', { n: est?.excludedNonGames ?? 0 }) }}</li>
                <li>{{ $t('valuation.method4') }}</li>
              </ul>
            </div>
            <div class="card">
              <h3 class="mb-2 font-semibold">{{ $t('valuation.coverage') }}</h3>
              <BaseChart :option="coverageOption" :loading="value.loading.value" height="220px" :label="$t('valuation.coverage')" />
            </div>
          </div>
          <div class="card overflow-x-auto p-0">
            <h3 class="px-5 pt-4 font-semibold">{{ $t('valuation.mostExpensive') }}</h3>
            <SkeletonBlock v-if="value.loading.value" class="m-5 h-40" />
            <table v-else-if="value.data.value?.mostExpensive.length" class="mt-2 w-full min-w-[32rem] text-sm">
              <thead class="border-b border-line text-left text-xs text-muted uppercase">
                <tr><th class="px-5 py-2">{{ $t('game.name') }}</th><th class="px-5 py-2 text-right">{{ $t('game.price') }}</th><th class="px-5 py-2 text-right">{{ $t('game.playtime') }}</th><th class="px-5 py-2 text-right">{{ $t('cost.perHour') }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="g in value.data.value.mostExpensive" :key="g.appId" class="border-b border-line/60 last:border-0">
                  <td class="px-5 py-2"><RouterLink :to="{ name: 'game', params: { appid: g.appId } }" class="hover:text-accent">{{ g.name }}</RouterLink></td>
                  <td class="px-5 py-2 text-right">{{ f.money(g.price) }}</td>
                  <td class="px-5 py-2 text-right">{{ g.playtimeMinutes > 0 ? f.hours(g.playtimeMinutes) : $t('cost.notPlayed') }}</td>
                  <td class="px-5 py-2 text-right">{{ f.costPerHour(g.costPerHour) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="p-5 text-sm text-muted">{{ $t('common.noData') }}</p>
          </div>
        </section>

        <section class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="section-title">{{ $t('valuation.modelB') }}</h2>
            <span class="badge bg-warning/15 text-warning">{{ $t('purchase.unverified') }}</span>
            <div class="ml-auto flex flex-wrap gap-2">
              <button type="button" class="btn btn-secondary" @click="openBundle(null)"><AppIcon name="layers" :size="16" />{{ $t('bundle.add') }}</button>
              <RouterLink :to="{ name: 'import' }" class="btn btn-primary"><AppIcon name="upload" :size="16" />{{ $t('import.cta') }}</RouterLink>
            </div>
          </div>
          <p class="text-sm text-muted">{{ $t('valuation.modelBDescription') }}</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <StatCard :label="$t('valuation.recordedSpending')" icon="wallet" :loading="value.loading.value" :unavailable="!value.data.value?.recorded.totals.length" :value="f.totals(value.data.value?.recorded.totals)" :hint="$t('valuation.noConversion')" />
            <StatCard
              :label="$t('valuation.purchaseCount')"
              icon="list"
              :loading="value.loading.value"
              :value="value.data.value ? f.number(value.data.value.recorded.purchaseCount) : null"
              :hint="value.data.value?.recorded.bundleCount ? $t('valuation.bundleCount', { n: value.data.value.recorded.bundleCount }) : undefined"
            />
          </div>
          <div class="card overflow-x-auto p-0">
            <ErrorState v-if="purchases.error.value" :error="purchases.error.value" compact @retry="purchases.reload" />
            <table v-else-if="purchaseGroups.length" class="w-full min-w-[40rem] text-sm">
              <thead class="border-b border-line text-left text-xs text-muted uppercase">
                <tr><th class="px-5 py-2">{{ $t('game.name') }}</th><th class="px-5 py-2 text-right">{{ $t('purchase.amount') }}</th><th class="px-5 py-2">{{ $t('purchase.date') }}</th><th class="px-5 py-2">{{ $t('purchase.source') }}</th><th class="px-5 py-2">{{ $t('purchase.notes') }}</th></tr>
              </thead>
              <tbody>
                <template v-for="g in purchaseGroups" :key="g.key">
                  <tr v-if="g.bundle" class="border-t border-line bg-surface-2/40">
                    <td class="px-5 py-2">
                      <button type="button" class="flex items-center gap-2 font-medium hover:text-accent" @click="openBundle(g.bundle.id)">
                        <AppIcon name="layers" :size="16" class="text-accent" />{{ $t('bundle.label', { n: g.items.length }) }}
                        <span v-if="g.items[0]!.origin === 'file_import'" class="badge bg-accent/10 text-accent">{{ $t('import.imported') }}</span>
                      </button>
                    </td>
                    <td class="px-5 py-2 text-right font-medium">{{ f.money({ amount: g.bundle.total, currency: g.items[0]!.currency }) }}</td>
                    <td class="px-5 py-2">{{ g.items[0]!.purchaseDate ?? $t('common.notRecorded') }}</td>
                    <td class="px-5 py-2">{{ $t(`purchase.sources.${g.items[0]!.source}`) }}</td>
                    <td class="max-w-xs truncate px-5 py-2 text-muted">{{ g.items[0]!.notes }}</td>
                  </tr>
                  <tr v-for="p in g.items" :key="p.appId" class="border-b border-line/60 last:border-0">
                    <td class="px-5 py-2" :class="g.bundle ? 'pl-11' : ''">
                      <RouterLink :to="{ name: 'game', params: { appid: p.appId } }" class="hover:text-accent">{{ p.gameName ?? `#${p.appId}` }}</RouterLink>
                      <span v-if="!g.bundle && p.origin === 'file_import'" class="badge ml-2 bg-accent/10 text-accent">{{ $t('import.imported') }}</span>
                    </td>
                    <td class="px-5 py-2 text-right" :class="g.bundle ? 'text-muted' : ''">{{ f.money(p) }}</td>
                    <td class="px-5 py-2">{{ g.bundle ? '' : (p.purchaseDate ?? $t('common.notRecorded')) }}</td>
                    <td class="px-5 py-2">{{ g.bundle ? '' : $t(`purchase.sources.${p.source}`) }}</td>
                    <td class="max-w-xs truncate px-5 py-2 text-muted">{{ g.bundle ? '' : p.notes }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
            <p v-else class="p-5 text-sm text-muted">{{ $t('valuation.noPurchases') }}</p>
          </div>
        </section>
      </template>
      <BundleEditor :open="bundleOpen" :bundle-id="bundleId" @close="bundleOpen = false" @saved="onBundleSaved" />
    </div>
  </SteamRequired>
</template>
