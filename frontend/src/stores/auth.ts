import { defineStore } from 'pinia';
import { computed, ref, shallowRef, triggerRef } from 'vue';
import { onIdTokenChanged, type User } from 'firebase/auth';
import type { MeDto, UpdateMeInput } from '@steam-analytics/shared';
import { auth } from '@/services/firebase';
import { api } from '@/services/api';
import { authService } from '@/services/authService';

export const useAuthStore = defineStore('auth', () => {
  const firebaseUser = shallowRef<User | null>(null);
  const me = ref<MeDto | null>(null);
  const meError = ref<unknown>(null);
  const ready = ref(false);
  let readyResolve!: () => void;
  const readyPromise = new Promise<void>((r) => (readyResolve = r));

  const isAuthenticated = computed(() => firebaseUser.value !== null);
  const emailVerified = computed(() => firebaseUser.value?.emailVerified ?? false);
  const steamLinked = computed(() => Boolean(me.value?.steamId));

  async function loadMe() {
    try {
      me.value = (await api.get<MeDto>('/me')).data;
      meError.value = null;
    } catch (err) {
      meError.value = err;
    }
  }

  function init() {
    onIdTokenChanged(auth, async (user) => {
      const changed = user?.uid !== firebaseUser.value?.uid;
      firebaseUser.value = user;
      if (!user) me.value = null;
      else if (changed || !me.value) await loadMe();
      ready.value = true;
      readyResolve();
    });
    return readyPromise;
  }

  /** Re-read emailVerified after the user clicked the verification link. */
  async function reloadUser() {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    // reload() mutates the same User object; force dependants (emailVerified) to re-evaluate.
    firebaseUser.value = auth.currentUser;
    triggerRef(firebaseUser);
    await loadMe();
  }

  async function updateMe(input: UpdateMeInput) {
    me.value = (await api.patch<MeDto>('/me', input)).data;
  }

  async function logout() {
    await authService.logout();
    me.value = null;
  }

  async function deleteAccount(password: string) {
    await authService.reauthenticate(password);
    await api.delete('/me');
    await authService.logout().catch(() => undefined);
    me.value = null;
  }

  return { firebaseUser, me, meError, ready, readyPromise, isAuthenticated, emailVerified, steamLinked, init, loadMe, reloadUser, updateMe, logout, deleteAccount };
});
