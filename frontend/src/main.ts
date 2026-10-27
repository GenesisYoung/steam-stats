import { createApp, watch } from 'vue';
import { createPinia } from 'pinia';
import './style.css';
import App from './App.vue';
import { router } from './router';
import { i18n, setLocale } from './locales';
import { useAuthStore } from './stores/auth';
import { setTheme } from './composables/useTheme';

const app = createApp(App);
app.use(createPinia());
app.use(i18n);

const authStore = useAuthStore();
void authStore.init();

// Apply server-side preferences once loaded.
watch(
  () => authStore.me?.preferences,
  (prefs) => {
    if (!prefs) return;
    setLocale(prefs.language);
    setTheme(prefs.theme);
  },
  { immediate: true },
);

router.afterEach((to) => {
  const key = to.meta.titleKey;
  document.title = key ? `${i18n.global.t(key)} · Steam Analytics` : 'Steam Analytics Dashboard';
});

app.use(router);
app.mount('#app');
