<script setup lang="ts">
import { useFormat } from '@/composables/useFormat';

defineProps<{ rows: { label: string; games: number; winRate: number | null }[] }>();
const f = useFormat();
</script>

<template>
  <ul class="flex flex-col gap-3">
    <li v-for="r in rows" :key="r.label" class="text-sm">
      <div class="mb-1 flex justify-between gap-2">
        <span>{{ r.label }}</span>
        <span class="text-muted">{{ f.percent(r.winRate) }} · {{ $t('dota.gamesCount', { n: f.number(r.games) }) }}</span>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-surface-2">
        <div class="h-full rounded-full" :class="(r.winRate ?? 0) >= 50 ? 'bg-success' : 'bg-danger'" :style="{ width: `${r.winRate ?? 0}%` }" />
      </div>
    </li>
  </ul>
</template>
