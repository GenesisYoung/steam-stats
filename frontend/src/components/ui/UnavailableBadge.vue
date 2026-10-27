<script setup lang="ts">
defineProps<{ label?: string; reason?: string }>();
</script>

<template>
  <span class="badge bg-surface-2 text-muted" :title="reason">{{ label ?? $t('common.unavailable') }}</span>
</template>
