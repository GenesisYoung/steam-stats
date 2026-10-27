<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) dialog.value?.showModal();
    else dialog.value?.close();
  },
  { flush: 'post' },
);
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-fg backdrop:bg-black/60"
    :aria-label="title"
    @close="emit('close')"
    @cancel.prevent="emit('close')"
  >
    <div class="flex flex-col gap-4 p-6">
      <h2 class="text-lg font-semibold">{{ title }}</h2>
      <slot />
      <div class="flex justify-end gap-2">
        <slot name="actions" />
      </div>
    </div>
  </dialog>
</template>
