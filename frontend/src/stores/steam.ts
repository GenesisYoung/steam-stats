import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { SteamAuthStartDto, SteamProfileDto, SyncJobDto, SyncScope, SyncStatusDto } from '@steam-analytics/shared';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from './auth';

const POLL_MS = 3000;

export const useSteamStore = defineStore('steam', () => {
  const profile = ref<SteamProfileDto | null>(null);
  const profileSource = ref<'live' | 'cache' | null>(null);
  const profileError = ref<unknown>(null);
  const profileLoading = ref(false);
  const sync = ref<SyncStatusDto | null>(null);
  /** Incremented when a sync finishes so views can reload their data. */
  const dataRevision = ref(0);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const syncing = computed(() => Boolean(sync.value?.active));

  async function loadProfile() {
    profileLoading.value = true;
    try {
      const res = await api.get<SteamProfileDto>('/steam/profile');
      profile.value = res.data;
      profileSource.value = res.meta?.source ?? null;
      profileError.value = null;
    } catch (err) {
      profileError.value = err;
    } finally {
      profileLoading.value = false;
    }
  }

  async function loadSyncStatus() {
    const wasActive = syncing.value;
    sync.value = (await api.get<SyncStatusDto>('/steam/sync/status')).data;
    if (sync.value.active) schedulePoll();
    else if (wasActive) {
      dataRevision.value += 1;
      await Promise.all([loadProfile(), useAuthStore().loadMe()]);
    }
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      loadSyncStatus().catch(() => schedulePoll());
    }, POLL_MS);
  }

  async function startSync(scope: SyncScope = 'full'): Promise<SyncJobDto | null> {
    try {
      const job = (await api.post<SyncJobDto>('/steam/sync', { scope })).data;
      sync.value = { active: job, latest: job, lastSuccessfulSyncAt: sync.value?.lastSuccessfulSyncAt ?? null };
      schedulePoll();
      return job;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SYNC_IN_PROGRESS') {
        await loadSyncStatus();
        return null;
      }
      throw err;
    }
  }

  /** Begins Steam OpenID: the backend sets a binding cookie and returns Steam's login URL. */
  async function startLink() {
    const { redirectUrl } = (await api.post<SteamAuthStartDto>('/steam/auth')).data;
    window.location.assign(redirectUrl);
  }

  async function unlink() {
    await api.delete('/steam/link');
    reset();
    await useAuthStore().loadMe();
  }

  function reset() {
    profile.value = null;
    sync.value = null;
    profileError.value = null;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  return { profile, profileSource, profileError, profileLoading, sync, syncing, dataRevision, loadProfile, loadSyncStatus, startSync, startLink, unlink, reset };
});
