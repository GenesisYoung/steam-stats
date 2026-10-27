<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/services/api';
import AppIcon from './AppIcon.vue';

const props = defineProps<{ error: unknown; compact?: boolean }>();
defineEmits<{ retry: [] }>();
const { t, te } = useI18n();

const message = computed(() => {
  if (props.error instanceof ApiError) {
    const key = `apiErrors.${props.error.code}`;
    return te(key) ? t(key) : props.error.message;
  }
  return t('errors.generic');
});
</script>

<template>
  <div role="alert" :class="compact ? 'flex items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm' : 'card flex flex-col items-center gap-3 py-10 text-center'">
    <AppIcon name="alert" :size="compact ? 18 : 28" class="text-danger" />
    <p class="text-fg">{{ message }}</p>
    <button type="button" class="btn btn-secondary" @click="$emit('retry')">{{ $t('common.retry') }}</button>
  </div>
</template>
