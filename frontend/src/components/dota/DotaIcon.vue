<script setup lang="ts">
import { ref, watch } from 'vue';

/** Hero or item image; falls back to a blank tile when the URL is missing or fails to load. */
const props = defineProps<{ src: string | null; name: string; imgClass?: string }>();
const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });
</script>

<template>
  <img v-if="src && !failed" :src="src" :alt="name" :title="name" loading="lazy" class="rounded object-cover" :class="imgClass" @error="failed = true" />
  <span v-else :title="name" class="inline-block rounded bg-surface-2" :class="imgClass" />
</template>
