/**
 * Integration-test harness: real Express app + Firebase Auth/Firestore
 * emulators + FakeSteam. Requires `firebase emulators:exec` (see root
 * package.json "test:integration").
 */
import request from 'supertest';
import { loadEnv } from '../../src/config/env';
import { initFirebase } from '../../src/config/firebase';
import { createContainer } from '../../src/container';
import { createApp } from '../../src/app';
import { TokenBucket } from '../../src/lib/http';
import { FakeSteam } from './fakeSteam';

export const PROJECT_ID = 'demo-steam-analytics';
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;

export const emulatorsAvailable = Boolean(FIRESTORE && AUTH);

export function createHarness(overrides: Record<string, string> = {}) {
  const env = loadEnv({
    NODE_ENV: 'test',
    PUBLIC_APP_URL: 'http://localhost:5173',
    PUBLIC_API_URL: 'http://localhost:5173',
    FIREBASE_PROJECT_ID: PROJECT_ID,
    STEAM_API_KEY: 'A'.repeat(32),
    CRON_SECRET: 'c'.repeat(40),
    TRUST_PROXY: '0',
    ...overrides,
  });
  const { db, auth } = initFirebase(PROJECT_ID);
  const steam = new FakeSteam();
  const container = createContainer({
    env, db, auth, fetchImpl: steam.fetch, retries: 1,
    limiters: { web: new TokenBucket(10_000, 10_000), store: new TokenBucket(10_000, 10_000) },
  });
  const app = createApp(container);
  return { env, db, auth, steam, container, app, http: () => request(app) };
}

export async function resetEmulators() {
  await Promise.all([
    fetch(`http://${FIRESTORE}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' }),
    fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' }),
  ]);
}

let counter = 0;

/** Creates an emulator user and returns a real Firebase ID token. */
export async function createUser(h: ReturnType<typeof createHarness>, opts: { verified?: boolean } = {}) {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.test`;
  const password = 'test-password-123';
  const user = await h.auth.createUser({ email, password, emailVerified: opts.verified ?? true });
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken: string };
  return { uid: user.uid, email, token: body.idToken, bearer: `Bearer ${body.idToken}` };
}
