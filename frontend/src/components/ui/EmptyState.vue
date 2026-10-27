<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineProps<{ title: string; description?: string; icon?: string }>();
</script>

<template>
  <div class="card flex flex-col items-center gap-3 py-12 text-center">
    <AppIcon :name="icon ?? 'info'" :size="32" class="text-muted" />
    <h3 class="text-base font-semibold">{{ title }}</h3>
    <p v-if="description" class="max-w-md text-sm text-muted">{{ description }}</p>
    <slot />
  </div>
</template>
