import { onMounted, ref, shallowRef, watch, type Ref, type WatchSource } from 'vue';
import type { ApiMeta, ApiSuccess } from '@steam-analytics/shared';

/** Loads API data with loading / error state; reloads when `sources` change. */
export function useApi<T>(loader: () => Promise<ApiSuccess<T>>, sources: WatchSource[] = []) {
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const meta = ref<ApiMeta | null>(null);
  const error = shallowRef<unknown>(null);
  const loading = ref(true);
  let seq = 0;

  async function reload() {
    const id = ++seq;
    loading.value = true;
    error.value = null;
    try {
      const res = await loader();
      if (id !== seq) return;
      data.value = res.data;
      meta.value = res.meta ?? null;
    } catch (err) {
      if (id === seq) error.value = err;
    } finally {
      if (id === seq) loading.value = false;
    }
  }

  onMounted(reload);
  if (sources.length) watch(sources, reload);
  return { data, meta, error, loading, reload };
}
