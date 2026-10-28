import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const d = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

d('Firestore Security Rules', () => {
  let env: RulesTestEnvironment;
  const prefs = { currency: 'USD', language: 'en', storeRegion: 'us', theme: 'dark', autoSync: true };

  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-steam-analytics-rules',
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firebase/firestore.rules'), 'utf8'), host, port: Number(port) },
    });
  });

  afterAll(async () => env?.cleanup());

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users/alice'), { uid: 'alice', email: 'a@x.test', displayName: 'Alice', steamId: '76561198000000001', preferences: prefs, dataVersion: 1 });
      await setDoc(doc(db, 'users/alice/games/10'), { appId: 10, name: 'G', playtimeForeverMinutes: 100 });
      await setDoc(doc(db, 'users/alice/steamProfile/current'), { steamId: '76561198000000001' });
      await setDoc(doc(db, 'steamLinks/76561198000000001'), { uid: 'alice' });
      await setDoc(doc(db, 'steamApps/10'), { appId: 10, type: 'game' });
      await setDoc(doc(db, 'steamApps/10/prices/us'), { appId: 10, finalMinor: 999 });
    });
  });

  const alice = () => env.authenticatedContext('alice').firestore();
  const bob = () => env.authenticatedContext('bob').firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  it('lets users read only their own data', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'users/alice')));
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/games/10')));
    await assertFails(getDoc(doc(bob(), 'users/alice')));
    await assertFails(getDoc(doc(bob(), 'users/alice/games/10')));
    await assertFails(getDoc(doc(anon(), 'users/alice')));
  });

  it('blocks client writes to trusted Steam data', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice/games/10'), { appId: 10, playtimeForeverMinutes: 999999 }));
    await assertFails(setDoc(doc(alice(), 'users/alice/games/10/achievements/state'), { unlocked: { A: 1 } }));
    await assertFails(setDoc(doc(alice(), 'users/alice/steamProfile/current'), { steamLevel: 999 }));
    await assertFails(setDoc(doc(alice(), 'users/alice/playtimeSnapshots/2026-01-01'), { totalMinutes: 1 }));
    await assertFails(setDoc(doc(alice(), 'users/alice/syncJobs/x'), { status: 'succeeded' }));
  });

  it('allows only displayName / preferences changes on the user doc', async () => {
    await assertSucceeds(updateDoc(doc(alice(), 'users/alice'), { displayName: 'Ali', preferences: { ...prefs, theme: 'light' } }));
    await assertFails(updateDoc(doc(alice(), 'users/alice'), { steamId: '76561198000000099' }));
    await assertFails(updateDoc(doc(alice(), 'users/alice'), { dataVersion: 99 }));
    await assertFails(updateDoc(doc(alice(), 'users/alice'), { preferences: { ...prefs, language: 'fr' } }));
    await assertFails(updateDoc(doc(alice(), 'users/alice'), { displayName: '' }));
    await assertFails(updateDoc(doc(bob(), 'users/alice'), { displayName: 'Hacked' }));
    await assertFails(setDoc(doc(alice(), 'users/mallory'), { uid: 'mallory' }));
    await assertFails(deleteDoc(doc(alice(), 'users/alice')));
  });

  it('validates user-entered purchases', async () => {
    const valid = () => ({ appId: 10, amount: 19.99, currency: 'USD', purchaseDate: '2024-01-01', source: 'steam', notes: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/gamePurchases/10'), valid()));
    await assertFails(setDoc(doc(alice(), 'users/alice/gamePurchases/11'), { ...valid(), appId: 11 })); // not owned
    await assertFails(setDoc(doc(alice(), 'users/alice/gamePurchases/10'), { ...valid(), amount: -1 }));
    await assertFails(setDoc(doc(alice(), 'users/alice/gamePurchases/10'), { ...valid(), verified: true }));
    await assertFails(setDoc(doc(alice(), 'users/alice/gamePurchases/10'), { ...valid(), createdAt: Timestamp.fromMillis(0) }));
    await assertFails(setDoc(doc(bob(), 'users/alice/gamePurchases/10'), valid()));
    await assertSucceeds(deleteDoc(doc(alice(), 'users/alice/gamePurchases/10')));
    const bundle = { id: 'b_abcdefgh1234', total: 30, itemCount: 2, allocation: 'store_price' };
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/gamePurchases/10'), { ...valid(), bundle, origin: 'file_import' }));
    await assertFails(setDoc(doc(alice(), 'users/alice/gamePurchases/10'), { ...valid(), bundle: { ...bundle, allocation: 'random' } }));
    await assertFails(setDoc(doc(alice(), 'users/alice/gamePurchases/10'), { ...valid(), bundle: { ...bundle, verified: true } }));
    await assertFails(setDoc(doc(alice(), 'users/alice/gamePurchases/10'), { ...valid(), origin: 'steam_api' }));
  });

  it('hides server-internal collections', async () => {
    // Hidden-game changes must go through the API so cache versions update atomically.
    await assertFails(setDoc(doc(alice(), 'users/alice/hiddenGames/10'), { appId: 10, excludeFromStats: true }));
    await assertFails(getDoc(doc(bob(), 'users/alice/hiddenGames/10')));
    await assertFails(getDoc(doc(alice(), 'steamLinks/76561198000000001')));
    await assertFails(setDoc(doc(alice(), 'steamLinks/76561198000000002'), { uid: 'alice' }));
    await assertFails(getDoc(doc(alice(), 'linkSessions/x')));
    await assertFails(getDoc(doc(alice(), 'openidNonces/x')));
  });

  it('exposes shared app data read-only to signed-in users', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'steamApps/10')));
    await assertSucceeds(getDoc(doc(bob(), 'steamApps/10/prices/us')));
    await assertFails(getDoc(doc(anon(), 'steamApps/10')));
    await assertFails(setDoc(doc(alice(), 'steamApps/10/prices/us'), { finalMinor: 1 }));
  });
});
