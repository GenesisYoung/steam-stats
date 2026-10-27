<script setup lang="ts">
import { useFormat } from '@/composables/useFormat';
import AppIcon from './AppIcon.vue';

defineProps<{ at: string | null | undefined; source?: 'live' | 'cache' | null }>();
const f = useFormat();
</script>

<template>
  <p class="flex items-center gap-1.5 text-xs text-muted">
    <AppIcon name="clock" :size="14" />
    <span v-if="source === 'live'">{{ $t('data.live', { time: f.relative(at) }) }}</span>
    <span v-else-if="at" :title="f.date(at, true)">{{ $t('data.cached', { time: f.relative(at) }) }}</span>
    <span v-else>{{ $t('data.neverSynced') }}</span>
  </p>
</template>
