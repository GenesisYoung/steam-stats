<script setup lang="ts">
import { ref } from 'vue';
import { authService, authErrorKey } from '@/services/authService';

const email = ref('');
const sent = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = null;
  try {
    await authService.resetPassword(email.value.trim());
    sent.value = true;
  } catch (err) {
    const key = authErrorKey(err);
    // Do not reveal whether an account exists.
    if (key === 'auth.errors.invalidCredential') sent.value = true;
    else error.value = key;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-2xl font-semibold">{{ $t('auth.forgotTitle') }}</h1>
    <p v-if="sent" role="status" class="rounded-lg bg-success/10 p-3 text-sm text-success">{{ $t('auth.resetSent') }}</p>
    <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
      <p class="text-sm text-muted">{{ $t('auth.forgotSubtitle') }}</p>
      <label>
        <span class="label">{{ $t('auth.email') }}</span>
        <input v-model="email" type="email" autocomplete="email" required class="input" />
      </label>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ $t(error) }}</p>
      <button type="submit" class="btn btn-primary" :disabled="busy || !email">{{ $t('auth.sendReset') }}</button>
    </form>
    <RouterLink :to="{ name: 'login' }" class="text-center text-sm text-accent hover:underline">{{ $t('auth.backToLogin') }}</RouterLink>
  </div>
</template>
