import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
    titleKey?: string;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'landing', component: () => import('@/views/LandingView.vue'), meta: { titleKey: 'nav.home' } },
  {
    path: '/',
    component: () => import('@/components/layout/AuthLayout.vue'),
    children: [
      { path: 'login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { guestOnly: true, titleKey: 'auth.login' } },
      { path: 'register', name: 'register', component: () => import('@/views/RegisterView.vue'), meta: { guestOnly: true, titleKey: 'auth.register' } },
      { path: 'forgot-password', name: 'forgot-password', component: () => import('@/views/ForgotPasswordView.vue'), meta: { guestOnly: true, titleKey: 'auth.forgotTitle' } },
      { path: 'verify-email', name: 'verify-email', component: () => import('@/views/VerifyEmailView.vue'), meta: { requiresAuth: true, titleKey: 'auth.verifyTitle' } },
    ],
  },
  {
    path: '/',
    component: () => import('@/components/layout/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { titleKey: 'nav.dashboard' } },
      { path: 'link-steam', name: 'link-steam', component: () => import('@/views/LinkSteamView.vue'), meta: { titleKey: 'link.title' } },
      { path: 'library', name: 'library', component: () => import('@/views/LibraryView.vue'), meta: { titleKey: 'nav.library' } },
      { path: 'games/:appid(\\d+)', name: 'game', component: () => import('@/views/GameDetailView.vue'), props: (r) => ({ appId: Number(r.params.appid) }), meta: { titleKey: 'nav.library' } },
      { path: 'achievements', name: 'achievements', component: () => import('@/views/AchievementsView.vue'), meta: { titleKey: 'nav.achievements' } },
      { path: 'analytics', name: 'analytics', component: () => import('@/views/AnalyticsView.vue'), meta: { titleKey: 'nav.analytics' } },
      { path: 'valuation', name: 'valuation', component: () => import('@/views/ValuationView.vue'), meta: { titleKey: 'nav.valuation' } },
      { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { titleKey: 'nav.settings' } },
    ],
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();
  await authStore.readyPromise;
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.guestOnly && authStore.isAuthenticated) return { name: 'dashboard' };
  return true;
});
