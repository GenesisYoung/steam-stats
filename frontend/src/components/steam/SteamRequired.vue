<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import EmptyState from '@/components/ui/EmptyState.vue';

const authStore = useAuthStore();
</script>

<template>
  <slot v-if="authStore.steamLinked" />
  <EmptyState v-else icon="steam" :title="$t('steamRequired.title')" :description="$t('steamRequired.description')">
    <RouterLink :to="{ name: 'link-steam' }" class="btn btn-primary">{{ $t('steamRequired.cta') }}</RouterLink>
  </EmptyState>
</template>
