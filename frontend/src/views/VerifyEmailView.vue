<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { authService, authErrorKey } from '@/services/authService';

const authStore = useAuthStore();
const router = useRouter();
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

async function resend() {
  if (!authStore.firebaseUser) return;
  busy.value = true;
  error.value = null;
  try {
    await authService.resendVerification(authStore.firebaseUser);
    message.value = 'auth.verificationResent';
  } catch (err) {
    error.value = authErrorKey(err);
  } finally {
    busy.value = false;
  }
}

async function check() {
  busy.value = true;
  error.value = null;
  await authStore.reloadUser();
  busy.value = false;
  if (authStore.emailVerified) await router.replace({ name: 'link-steam' });
  else error.value = 'auth.notVerifiedYet';
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-2xl font-semibold">{{ $t('auth.verifyTitle') }}</h1>
    <p class="text-sm text-muted">{{ $t('auth.verifyDescription', { email: authStore.firebaseUser?.email }) }}</p>
    <p v-if="authStore.emailVerified" class="rounded-lg bg-success/10 p-3 text-sm text-success">{{ $t('auth.verified') }}</p>
    <p v-if="message" role="status" class="text-sm text-success">{{ $t(message) }}</p>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ $t(error) }}</p>
    <button type="button" class="btn btn-primary" :disabled="busy" @click="check">{{ $t('auth.iVerified') }}</button>
    <button type="button" class="btn btn-secondary" :disabled="busy" @click="resend">{{ $t('auth.resend') }}</button>
    <RouterLink :to="{ name: 'dashboard' }" class="text-center text-sm text-accent hover:underline">{{ $t('auth.later') }}</RouterLink>
  </div>
</template>
