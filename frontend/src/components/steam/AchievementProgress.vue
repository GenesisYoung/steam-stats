<script setup lang="ts">
import { computed } from 'vue';
import type { GameAchievementSummaryDto } from '@steam-analytics/shared';

const props = defineProps<{ summary: GameAchievementSummaryDto; compact?: boolean }>();

const label = computed(() => {
  switch (props.summary.status) {
    case 'available': return null;
    case 'none': return 'achievements.status.none';
    case 'private': return 'achievements.status.private';
    case 'error': return 'achievements.status.error';
    default: return 'achievements.status.unknown';
  }
});
</script>

<template>
  <div class="flex flex-col gap-1">
    <template v-if="!label && summary.total">
      <div class="flex items-center justify-between text-xs text-muted">
        <span>{{ $t('achievements.progress', { unlocked: summary.unlocked ?? 0, total: summary.total }) }}</span>
        <span class="font-medium text-fg">{{ summary.percent ?? 0 }}%</span>
      </div>
      <div
        class="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        :aria-valuenow="summary.percent ?? 0"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="$t('achievements.completion')"
      >
        <div class="h-full rounded-full transition-all" :class="(summary.percent ?? 0) >= 100 ? 'bg-success' : 'bg-accent'" :style="{ width: `${summary.percent ?? 0}%` }" />
      </div>
    </template>
    <span v-else class="text-xs text-muted">{{ $t(label ?? 'achievements.status.none') }}</span>
  </div>
</template>
