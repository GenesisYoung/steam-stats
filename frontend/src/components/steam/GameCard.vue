<script setup lang="ts">
import { ref } from 'vue';
import type { GameListItemDto } from '@steam-analytics/shared';
import { useFormat } from '@/composables/useFormat';
import AchievementProgress from './AchievementProgress.vue';
import PriceTag from './PriceTag.vue';

defineProps<{ game: GameListItemDto }>();
const f = useFormat();
const imgFailed = ref(false);
</script>

<template>
  <RouterLink
    :to="{ name: 'game', params: { appid: game.appId } }"
    class="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition hover:-translate-y-0.5 hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-accent"
  >
    <div class="relative aspect-[460/215] bg-surface-2">
      <img v-if="!imgFailed" :src="game.coverUrl" :alt="''" loading="lazy" class="h-full w-full object-cover" @error="imgFailed = true" />
      <div v-else class="flex h-full items-center justify-center p-3 text-center text-sm text-muted">{{ game.name }}</div>
      <span v-if="game.playtime2WeeksMinutes > 0" class="badge absolute top-2 left-2 bg-black/70 text-accent">{{ $t('library.recent', { time: f.hours(game.playtime2WeeksMinutes) }) }}</span>
    </div>
    <div class="flex flex-1 flex-col gap-3 p-4">
      <div class="flex items-start justify-between gap-2">
        <h3 class="line-clamp-2 font-medium text-fg group-hover:text-accent">{{ game.name }}</h3>
        <span class="shrink-0 text-xs text-muted">#{{ game.appId }}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div class="text-xs text-muted">{{ $t('game.playtime') }}</div>
          <div class="font-medium">{{ game.playtimeForeverMinutes > 0 ? f.hours(game.playtimeForeverMinutes) : $t('cost.notPlayed') }}</div>
        </div>
        <div class="text-right">
          <div class="text-xs text-muted">{{ $t('game.price') }}</div>
          <PriceTag :price="game.price" />
        </div>
      </div>
      <AchievementProgress :summary="game.achievements" />
      <div class="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs">
        <span class="text-muted">{{ $t('cost.estimatedPerHour') }}</span>
        <span class="font-medium">{{ f.costPerHour(game.estimatedCostPerHour) }}</span>
      </div>
    </div>
  </RouterLink>
</template>
