<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { DotaMatchListDto, DotaQueue } from '@steam-analytics/shared';
import { api } from '@/services/api';
import { useApi } from '@/composables/useAsync';
import { useFormat } from '@/composables/useFormat';
import { useDotaLabels } from '@/composables/useDotaLabels';
import DotaIcon from '@/components/dota/DotaIcon.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';

const route = useRoute();
const f = useFormat();
const labels = useDotaLabels();

const PAGE_SIZE = 25;
const queue = ref<DotaQueue>('all');
const result = ref<'all' | 'win' | 'loss'>('all');
const heroId = ref<string>(typeof route.query.heroId === 'string' ? route.query.heroId : '');
const page = ref(1);
watch([queue, result, heroId], () => { page.value = 1; });

const res = useApi(
  () => api.get<DotaMatchListDto>('/dota/matches', { queue: queue.value, result: result.value, heroId: heroId.value, page: page.value, pageSize: PAGE_SIZE }),
  [queue, result, heroId, page],
);

const items = computed(() => res.data.value?.items ?? []);
const total = computed(() => res.meta.value?.total ?? 0);
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
</script>

<template>
  <div class="flex flex-col gap-4">
    <ErrorState v-if="res.error.value" :error="res.error.value" @retry="res.reload" />
    <template v-else>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-xs text-muted">{{ res.meta.value?.dataAsOf ? $t('dota.dataAsOf', { time: f.relative(res.meta.value.dataAsOf) }) : '' }}</p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <select v-model="heroId" class="input sm:w-48" :aria-label="$t('dota.hero')">
            <option value="">{{ $t('dota.allHeroes') }}</option>
            <option v-for="h in res.data.value?.heroes ?? []" :key="h.id" :value="String(h.id)">{{ h.name }}</option>
          </select>
          <select v-model="queue" class="input sm:w-40" :aria-label="$t('dota.queue')">
            <option value="all">{{ $t('dota.queueAll') }}</option>
            <option value="ranked">{{ $t('dota.queueRanked') }}</option>
            <option value="unranked">{{ $t('dota.queueUnranked') }}</option>
            <option value="turbo">{{ $t('dota.queueTurbo') }}</option>
          </select>
          <select v-model="result" class="input sm:w-36" :aria-label="$t('dota.result')">
            <option value="all">{{ $t('dota.resultAll') }}</option>
            <option value="win">{{ $t('dota.win') }}</option>
            <option value="loss">{{ $t('dota.loss') }}</option>
          </select>
        </div>
      </div>

      <section class="card">
        <SkeletonBlock v-if="res.loading.value" class="h-96" />
        <EmptyState v-else-if="items.length === 0" icon="swords" :title="$t('dota.noMatches')" :description="$t('dota.emptyDescription')" />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead class="text-xs text-muted">
              <tr>
                <th class="py-2 pr-3 font-medium">{{ $t('dota.hero') }}</th>
                <th class="px-3 py-2 font-medium">{{ $t('dota.result') }}</th>
                <th class="px-3 py-2 font-medium">{{ $t('dota.modeLabel') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ $t('dota.kdaLine') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ $t('dota.gpm') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ $t('dota.xpm') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ $t('dota.durationLabel') }}</th>
                <th class="pl-3 py-2 text-right font-medium">{{ $t('dota.played') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in items" :key="m.matchId" class="border-t border-line hover:bg-surface-2">
                <td class="py-2 pr-3">
                  <RouterLink :to="{ name: 'dota-match', params: { matchid: m.matchId } }" class="flex items-center gap-2 font-medium hover:text-accent">
                    <DotaIcon :src="m.hero.imageUrl" name="" img-class="h-7 w-12" />
                    {{ m.hero.name }}
                  </RouterLink>
                </td>
                <td class="px-3 py-2" :class="m.won === null ? 'text-muted' : m.won ? 'text-success' : 'text-danger'">
                  {{ m.won === null ? $t('dota.noResult') : m.won ? $t('dota.win') : $t('dota.loss') }}
                </td>
                <td class="px-3 py-2 text-muted">{{ labels.gameMode(m.gameMode) }}<span v-if="m.ranked"> · {{ $t('dota.ranked') }}</span></td>
                <td class="px-3 py-2 text-right">{{ m.kills }} / {{ m.deaths }} / {{ m.assists }}</td>
                <td class="px-3 py-2 text-right">{{ m.gpm ?? '—' }}</td>
                <td class="px-3 py-2 text-right">{{ m.xpm ?? '—' }}</td>
                <td class="px-3 py-2 text-right">{{ f.clock(m.durationSeconds) }}</td>
                <td class="pl-3 py-2 text-right text-muted">{{ f.relative(m.startTime) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div v-if="total > 0" class="flex items-center justify-between gap-2 text-sm text-muted">
        <span>{{ $t('dota.pageOf', { page, pages, total: f.number(total) }) }}</span>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" :disabled="page <= 1 || res.loading.value" @click="page -= 1">{{ $t('common.previous') }}</button>
          <button type="button" class="btn btn-secondary" :disabled="page >= pages || res.loading.value" @click="page += 1">{{ $t('common.next') }}</button>
        </div>
      </div>
    </template>
  </div>
</template>
