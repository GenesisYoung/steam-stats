<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CURRENCIES, STORE_REGIONS, SUPPORTED_LANGUAGES, THEMES, type UserPreferences } from '@steam-analytics/shared';
import { useAuthStore } from '@/stores/auth';
import { useSteamStore } from '@/stores/steam';
import { useFormat } from '@/composables/useFormat';
import { authErrorKey } from '@/services/authService';
import { ApiError } from '@/services/api';
import ErrorState from '@/components/ui/ErrorState.vue';
import ModalDialog from '@/components/ui/ModalDialog.vue';
import UserProfileCard from '@/components/steam/UserProfileCard.vue';

const authStore = useAuthStore();
const steam = useSteamStore();
const router = useRouter();
const f = useFormat();

const displayName = ref(authStore.me?.displayName ?? '');
const prefs = reactive<UserPreferences>({ ...(authStore.me?.preferences as UserPreferences) });
watch(() => authStore.me, (me) => {
  if (!me) return;
  displayName.value = me.displayName;
  Object.assign(prefs, me.preferences);
});

const saving = ref(false);
const saved = ref(false);
const saveError = ref<unknown>(null);
async function save() {
  saving.value = true;
  saved.value = false;
  saveError.value = null;
  const regionChanged = prefs.storeRegion !== authStore.me?.preferences.storeRegion;
  try {
    await authStore.updateMe({ displayName: displayName.value.trim(), preferences: { ...prefs } });
    saved.value = true;
    if (regionChanged && authStore.steamLinked) steam.dataRevision += 1;
  } catch (err) {
    saveError.value = err;
  } finally {
    saving.value = false;
  }
}

// ---- Sync controls ----
const syncError = ref<unknown>(null);
async function runSync(scope: 'profile' | 'full') {
  syncError.value = null;
  try {
    await steam.startSync(scope);
  } catch (err) {
    syncError.value = err;
  }
}

// ---- Unlink ----
const unlinkOpen = ref(false);
const unlinkError = ref<unknown>(null);
async function unlink() {
  unlinkError.value = null;
  try {
    await steam.unlink();
    unlinkOpen.value = false;
  } catch (err) {
    unlinkError.value = err;
  }
}

// ---- Delete account ----
const deleteOpen = ref(false);
const deletePassword = ref('');
const deleteConfirm = ref('');
const deleteError = ref<string | null>(null);
const deleting = ref(false);
async function deleteAccount() {
  deleting.value = true;
  deleteError.value = null;
  try {
    await authStore.deleteAccount(deletePassword.value);
    steam.reset();
    await router.replace({ name: 'landing' });
  } catch (err) {
    deleteError.value = err instanceof ApiError ? `apiErrors.${err.code}` : authErrorKey(err);
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-6">
    <h1 class="text-2xl font-semibold">{{ $t('settings.title') }}</h1>

    <form class="card flex flex-col gap-4" @submit.prevent="save">
      <h2 class="section-title">{{ $t('settings.profile') }}</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <label>
          <span class="label">{{ $t('auth.displayName') }}</span>
          <input v-model="displayName" maxlength="50" required class="input" />
        </label>
        <label>
          <span class="label">{{ $t('auth.email') }}</span>
          <input :value="authStore.me?.email" disabled class="input opacity-70" />
        </label>
      </div>
      <h2 class="section-title pt-2">{{ $t('settings.preferences') }}</h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label>
          <span class="label">{{ $t('settings.language') }}</span>
          <select v-model="prefs.language" class="input">
            <option v-for="l in SUPPORTED_LANGUAGES" :key="l" :value="l">{{ $t(`settings.languages.${l}`) }}</option>
          </select>
        </label>
        <label>
          <span class="label">{{ $t('settings.theme') }}</span>
          <select v-model="prefs.theme" class="input">
            <option v-for="th in THEMES" :key="th" :value="th">{{ $t(`settings.themes.${th}`) }}</option>
          </select>
        </label>
        <label>
          <span class="label">{{ $t('settings.currency') }}</span>
          <select v-model="prefs.currency" class="input">
            <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
          </select>
          <span class="mt-1 block text-xs text-muted">{{ $t('settings.currencyHint') }}</span>
        </label>
        <label>
          <span class="label">{{ $t('settings.region') }}</span>
          <select v-model="prefs.storeRegion" class="input">
            <option v-for="r in STORE_REGIONS" :key="r.code" :value="r.code">{{ r.code.toUpperCase() }} · {{ r.currency }}</option>
          </select>
          <span class="mt-1 block text-xs text-muted">{{ $t('settings.regionHint') }}</span>
        </label>
        <label class="flex items-center gap-3 self-start pt-7">
          <input v-model="prefs.autoSync" type="checkbox" class="h-4 w-4 accent-[var(--accent-strong)]" />
          <span class="text-sm">{{ $t('settings.autoSync') }}</span>
        </label>
      </div>
      <ErrorState v-if="saveError" :error="saveError" compact @retry="save" />
      <div class="flex items-center gap-3">
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ $t('common.save') }}</button>
        <span v-if="saved" role="status" class="text-sm text-success">{{ $t('settings.saved') }}</span>
      </div>
    </form>

    <section class="card flex flex-col gap-4">
      <h2 class="section-title">{{ $t('settings.steam') }}</h2>
      <template v-if="authStore.steamLinked">
        <UserProfileCard v-if="steam.profile" :profile="steam.profile" :source="steam.profileSource" />
        <p v-else class="font-mono text-sm">SteamID64: {{ authStore.me?.steamId }}</p>
        <div class="flex flex-col gap-2 rounded-lg bg-surface-2 p-4 text-sm">
          <p>{{ $t('settings.lastSync', { time: f.relative(steam.sync?.lastSuccessfulSyncAt ?? authStore.me?.lastSuccessfulSyncAt) }) }}</p>
          <p v-if="steam.sync?.latest" class="text-muted">
            {{ $t('settings.latestJob', { status: $t(`sync.status.${steam.sync.latest.status}`), time: f.date(steam.sync.latest.startedAt, true) }) }}
            <span v-if="steam.sync.latest.stats.achievementsRemaining || steam.sync.latest.stats.pricesRemaining">
              · {{ $t('settings.remaining', { a: steam.sync.latest.stats.achievementsRemaining, p: steam.sync.latest.stats.pricesRemaining }) }}
            </span>
          </p>
          <p v-if="steam.sync?.latest?.error" class="text-danger">{{ steam.sync.latest.error.message }}</p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn btn-secondary" :disabled="steam.syncing" @click="runSync('profile')">{{ $t('settings.syncProfile') }}</button>
            <button type="button" class="btn btn-primary" :disabled="steam.syncing" @click="runSync('full')">{{ steam.syncing ? $t('sync.inProgress') : $t('settings.syncFull') }}</button>
          </div>
          <ErrorState v-if="syncError" :error="syncError" compact @retry="runSync('full')" />
        </div>
        <button type="button" class="btn btn-secondary self-start text-danger" @click="unlinkOpen = true">{{ $t('settings.unlink') }}</button>
      </template>
      <template v-else>
        <p class="text-sm text-muted">{{ $t('steamRequired.description') }}</p>
        <RouterLink :to="{ name: 'link-steam' }" class="btn btn-primary self-start">{{ $t('steamRequired.cta') }}</RouterLink>
      </template>
    </section>

    <section class="card flex flex-col gap-3 border-danger/40">
      <h2 class="section-title text-danger">{{ $t('settings.danger') }}</h2>
      <p class="text-sm text-muted">{{ $t('settings.deleteDescription') }}</p>
      <button type="button" class="btn btn-danger self-start" @click="deleteOpen = true">{{ $t('settings.deleteAccount') }}</button>
    </section>

    <ModalDialog :open="unlinkOpen" :title="$t('settings.unlinkTitle')" @close="unlinkOpen = false">
      <p class="text-sm text-muted">{{ $t('settings.unlinkBody') }}</p>
      <ErrorState v-if="unlinkError" :error="unlinkError" compact @retry="unlink" />
      <template #actions>
        <button type="button" class="btn btn-ghost" @click="unlinkOpen = false">{{ $t('common.cancel') }}</button>
        <button type="button" class="btn btn-danger" @click="unlink">{{ $t('settings.unlink') }}</button>
      </template>
    </ModalDialog>

    <ModalDialog :open="deleteOpen" :title="$t('settings.deleteTitle')" @close="deleteOpen = false">
      <p class="text-sm text-muted">{{ $t('settings.deleteBody') }}</p>
      <label>
        <span class="label">{{ $t('settings.deletePassword') }}</span>
        <input v-model="deletePassword" type="password" autocomplete="current-password" class="input" />
      </label>
      <label>
        <span class="label">{{ $t('settings.deleteTypeConfirm') }}</span>
        <input v-model="deleteConfirm" class="input" placeholder="DELETE" />
      </label>
      <p v-if="deleteError" role="alert" class="text-sm text-danger">{{ $t(deleteError) }}</p>
      <template #actions>
        <button type="button" class="btn btn-ghost" @click="deleteOpen = false">{{ $t('common.cancel') }}</button>
        <button type="button" class="btn btn-danger" :disabled="deleting || !deletePassword || deleteConfirm !== 'DELETE'" @click="deleteAccount">{{ $t('settings.deleteAccount') }}</button>
      </template>
    </ModalDialog>
  </div>
</template>
