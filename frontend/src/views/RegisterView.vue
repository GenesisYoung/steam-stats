<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { authService, authErrorKey } from '@/services/authService';
import { useAuthStore } from '@/stores/auth';

const displayName = ref('');
const email = ref('');
const password = ref('');
const confirm = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const router = useRouter();
const authStore = useAuthStore();

const passwordProblem = computed(() => {
  if (!password.value) return null;
  if (password.value.length < 8) return 'auth.errors.passwordLength';
  if (confirm.value && confirm.value !== password.value) return 'auth.errors.passwordMismatch';
  return null;
});
const valid = computed(() => displayName.value.trim() && /.+@.+\..+/.test(email.value) && password.value.length >= 8 && password.value === confirm.value);

async function submit() {
  if (!valid.value) return;
  error.value = null;
  busy.value = true;
  try {
    const name = displayName.value.trim().slice(0, 50);
    await authService.register(email.value.trim(), password.value, name);
    // The profile document may have been created before updateProfile() finished.
    await authStore.updateMe({ displayName: name }).catch(() => undefined);
    await router.replace({ name: 'verify-email' });
  } catch (err) {
    error.value = authErrorKey(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
    <div>
      <h1 class="text-2xl font-semibold">{{ $t('auth.registerTitle') }}</h1>
      <p class="mt-1 text-sm text-muted">{{ $t('auth.registerSubtitle') }}</p>
    </div>
    <label>
      <span class="label">{{ $t('auth.displayName') }}</span>
      <input v-model="displayName" type="text" autocomplete="nickname" maxlength="50" required class="input" />
    </label>
    <label>
      <span class="label">{{ $t('auth.email') }}</span>
      <input v-model="email" type="email" autocomplete="email" required class="input" />
    </label>
    <label>
      <span class="label">{{ $t('auth.password') }}</span>
      <input v-model="password" type="password" autocomplete="new-password" minlength="8" required class="input" />
    </label>
    <label>
      <span class="label">{{ $t('auth.confirmPassword') }}</span>
      <input v-model="confirm" type="password" autocomplete="new-password" required class="input" />
    </label>
    <p v-if="passwordProblem" class="text-sm text-warning">{{ $t(passwordProblem) }}</p>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ $t(error) }}</p>
    <button type="submit" class="btn btn-primary" :disabled="busy || !valid">{{ busy ? $t('common.loading') : $t('auth.register') }}</button>
    <p class="text-xs text-muted">{{ $t('auth.noSteamPassword') }}</p>
    <RouterLink :to="{ name: 'login' }" class="text-center text-sm text-accent hover:underline">{{ $t('auth.haveAccount') }}</RouterLink>
  </form>
</template>
