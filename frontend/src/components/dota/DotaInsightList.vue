<script setup lang="ts">
import type { DotaInsight } from '@steam-analytics/shared';
import { useDotaLabels } from '@/composables/useDotaLabels';
import AppIcon from '@/components/ui/AppIcon.vue';

defineProps<{ insights: DotaInsight[] }>();
const labels = useDotaLabels();

const icon = { good: 'arrowUp', bad: 'arrowDown', neutral: 'info' } as const;
const color = { good: 'text-success', bad: 'text-danger', neutral: 'text-accent' } as const;
</script>

<template>
  <ul class="grid gap-2 md:grid-cols-2">
    <li v-for="i in insights" :key="i.code" class="flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-sm">
      <AppIcon :name="icon[i.tone]" :size="16" class="mt-0.5 shrink-0" :class="color[i.tone]" />
      <span>{{ labels.insight(i) }}</span>
    </li>
  </ul>
</template>
