import { getApps, initializeApp, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export interface FirebaseServices {
  app: App;
  auth: Auth;
  db: Firestore;
}

export function initFirebase(projectId: string): FirebaseServices {
  const usingEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const app =
    getApps()[0] ??
    initializeApp(usingEmulators ? { projectId } : { projectId, credential: applicationDefault() });
  const db = getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() may only be called once per instance (e.g. hot reload); ignore.
  }
  return { app, auth: getAuth(app), db };
}
