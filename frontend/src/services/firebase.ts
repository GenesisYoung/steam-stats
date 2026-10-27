import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp = initializeApp(config);
export const auth = getAuth(firebaseApp);

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, import.meta.env.VITE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099', { disableWarnings: true });
}

// Persistent sessions across browser restarts.
void setPersistence(auth, browserLocalPersistence);
