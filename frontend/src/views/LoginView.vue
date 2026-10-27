<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { authService, authErrorKey } from '@/services/authService';

const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const router = useRouter();
const route = useRoute();

async function submit() {
  error.value = null;
  busy.value = true;
  try {
    await authService.login(email.value.trim(), password.value);
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') && !route.query.redirect.startsWith('//') ? route.query.redirect : '/dashboard';
    await router.replace(redirect);
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
      <h1 class="text-2xl font-semibold">{{ $t('auth.loginTitle') }}</h1>
      <p class="mt-1 text-sm text-muted">{{ $t('auth.loginSubtitle') }}</p>
    </div>
    <label>
      <span class="label">{{ $t('auth.email') }}</span>
      <input v-model="email" type="email" autocomplete="email" required class="input" />
    </label>
    <label>
      <span class="label">{{ $t('auth.password') }}</span>
      <input v-model="password" type="password" autocomplete="current-password" required class="input" />
    </label>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ $t(error) }}</p>
    <button type="submit" class="btn btn-primary" :disabled="busy || !email || !password">{{ busy ? $t('common.loading') : $t('auth.login') }}</button>
    <div class="flex justify-between text-sm">
      <RouterLink :to="{ name: 'forgot-password' }" class="text-accent hover:underline">{{ $t('auth.forgot') }}</RouterLink>
      <RouterLink :to="{ name: 'register' }" class="text-accent hover:underline">{{ $t('auth.noAccount') }}</RouterLink>
    </div>
  </form>
</template>
