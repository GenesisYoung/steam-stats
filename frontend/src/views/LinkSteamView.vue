<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useSteamStore } from '@/stores/steam';
import AppIcon from '@/components/ui/AppIcon.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import UserProfileCard from '@/components/steam/UserProfileCard.vue';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const steam = useSteamStore();
const busy = ref(false);
const startError = ref<unknown>(null);

const status = computed(() => (route.query.status === 'success' || route.query.status === 'error' ? route.query.status : null));
const reason = computed(() => (typeof route.query.reason === 'string' ? route.query.reason : 'unknown'));

onMounted(async () => {
  if (status.value === 'success') {
    await authStore.loadMe();
    await Promise.all([steam.loadSyncStatus().catch(() => undefined), steam.loadProfile()]);
  }
});

async function link() {
  busy.value = true;
  startError.value = null;
  try {
    await steam.startLink();
  } catch (err) {
    startError.value = err;
    busy.value = false;
  }
}

function clearStatus() {
  void router.replace({ name: 'link-steam' });
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold">{{ $t('link.title') }}</h1>
      <p class="mt-1 text-muted">{{ $t('link.subtitle') }}</p>
    </div>

    <div v-if="status === 'success'" role="status" class="flex items-start gap-3 rounded-xl border border-success/40 bg-success/10 p-4">
      <AppIcon name="check" class="mt-0.5 text-success" />
      <div class="flex-1">
        <p class="font-medium">{{ $t('link.success') }}</p>
        <p class="text-sm text-muted">{{ $t('link.successHint') }}</p>
      </div>
      <RouterLink :to="{ name: 'dashboard' }" class="btn btn-primary">{{ $t('link.goDashboard') }}</RouterLink>
    </div>
    <div v-else-if="status === 'error'" role="alert" class="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/10 p-4">
      <AppIcon name="alert" class="mt-0.5 text-danger" />
      <div class="flex-1">
        <p class="font-medium">{{ $t('link.failed') }}</p>
        <p class="text-sm text-muted">{{ $te(`link.reasons.${reason}`) ? $t(`link.reasons.${reason}`) : $t('link.reasons.unknown') }}</p>
      </div>
      <button type="button" class="btn btn-ghost" @click="clearStatus">{{ $t('common.dismiss') }}</button>
    </div>

    <UserProfileCard v-if="authStore.steamLinked && steam.profile" :profile="steam.profile" :source="steam.profileSource" />

    <section v-if="!authStore.steamLinked" class="card flex flex-col gap-5">
      <ol class="flex flex-col gap-3 text-sm">
        <li v-for="n in 3" :key="n" class="flex gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{{ n }}</span>
          <span>{{ $t(`link.steps.${n}`) }}</span>
        </li>
      </ol>
      <div class="flex items-start gap-3 rounded-lg bg-surface-2 p-3 text-sm text-muted">
        <AppIcon name="lock" class="mt-0.5 shrink-0 text-accent" />
        <p>{{ $t('link.security') }}</p>
      </div>
      <p v-if="!authStore.emailVerified" class="text-sm text-warning">
        {{ $t('link.verifyFirst') }}
        <RouterLink :to="{ name: 'verify-email' }" class="underline">{{ $t('auth.verifyBannerCta') }}</RouterLink>
      </p>
      <ErrorState v-if="startError" :error="startError" compact @retry="link" />
      <button type="button" class="btn btn-primary self-start px-6 py-3" :disabled="busy || !authStore.emailVerified" @click="link">
        <AppIcon name="steam" /> {{ busy ? $t('link.redirecting') : $t('link.cta') }}
      </button>
    </section>

    <section class="card text-sm text-muted">
      <h2 class="mb-2 font-semibold text-fg">{{ $t('link.privacyTitle') }}</h2>
      <p>{{ $t('link.privacyBody') }}</p>
      <a href="https://steamcommunity.com/my/edit/settings" target="_blank" rel="noopener noreferrer" class="mt-2 inline-flex items-center gap-1 text-accent hover:underline">
        {{ $t('link.privacySettings') }} <AppIcon name="external" :size="14" />
      </a>
    </section>
  </div>
</template>
