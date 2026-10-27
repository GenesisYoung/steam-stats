<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
</script>

<template>
  <div v-if="!authStore.ready" class="flex min-h-screen items-center justify-center" aria-busy="true">
    <div class="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
  </div>
  <RouterView v-else />
</template>
