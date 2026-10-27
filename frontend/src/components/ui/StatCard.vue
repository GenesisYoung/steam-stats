<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import SkeletonBlock from './SkeletonBlock.vue';

defineProps<{ label: string; value?: string | null; hint?: string; icon?: string; loading?: boolean; unavailable?: boolean }>();
</script>

<template>
  <div class="card flex flex-col gap-2" :aria-busy="loading">
    <div class="flex items-center justify-between text-sm text-muted">
      <span>{{ label }}</span>
      <AppIcon v-if="icon" :name="icon" :size="18" class="text-accent" />
    </div>
    <SkeletonBlock v-if="loading" class="h-8 w-2/3" />
    <div v-else class="text-2xl font-semibold tracking-tight" :class="unavailable ? 'text-muted' : 'text-fg'">
      {{ unavailable ? $t('common.unavailable') : value }}
    </div>
    <p v-if="hint && !loading" class="text-xs text-muted">{{ hint }}</p>
    <slot />
  </div>
</template>
