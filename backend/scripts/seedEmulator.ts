/**
 * DEVELOPMENT ONLY — seeds the local Firestore emulator with clearly fake
 * Steam data for an existing emulator user, so the UI can be previewed
 * without a Steam API key. Refuses to run against a real project.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     npx tsx backend/scripts/seedEmulator.ts <email>
 *
 * Local emulator test account used during development (emulator only, not a real account):
 *   email: demo@example.test   password: demo-pass-8421
 */
import { initFirebase } from '../src/config/firebase';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Refusing to run: emulator environment variables are not set.');
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: seedEmulator.ts <email of an emulator user>');
  process.exit(1);
}

const { db, auth } = initFirebase(process.env.FIREBASE_PROJECT_ID ?? 'demo-steam-analytics');
const user = await auth.getUserByEmail(email);
const uid = user.uid;
const steamId = '76561190000000001';
const now = new Date();
const day = 86_400_000;

const games = [
  { appId: 1091500, name: '[DEMO] Cyberpunk 2077', minutes: 7200, recent: 300, total: 57, unlocked: 31, price: 5999 },
  { appId: 570, name: '[DEMO] Dota 2', minutes: 48000, recent: 900, total: 0, unlocked: 0, price: null, free: true },
  { appId: 620, name: '[DEMO] Portal 2', minutes: 900, recent: 0, total: 51, unlocked: 51, price: 999 },
  { appId: 413150, name: '[DEMO] Stardew Valley', minutes: 6300, recent: 120, total: 49, unlocked: 22, price: 1499 },
  { appId: 1245620, name: '[DEMO] Elden Ring', minutes: 0, recent: 0, total: 42, unlocked: 0, price: 5999 },
  { appId: 292030, name: '[DEMO] The Witcher 3', minutes: 4200, recent: 0, total: 78, unlocked: 40, price: null },
];

const batch = db.batch();
batch.set(db.doc(`users/${uid}`), {
  uid, email, displayName: user.displayName ?? 'Demo', createdAt: now, lastLoginAt: now, steamId, steamLinkedAt: now,
  preferences: { currency: 'USD', language: 'en', storeRegion: 'us', theme: 'dark', autoSync: false },
  dataVersion: Date.now(), lastSuccessfulSyncAt: now, activeSyncJobId: null, syncLockExpiresAt: null,
});
batch.set(db.doc(`steamLinks/${steamId}`), { steamId, uid, linkedAt: now });
batch.set(db.doc(`users/${uid}/steamProfile/current`), {
  steamId, personaName: '[DEMO] Player', avatarUrl: 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg',
  profileUrl: 'https://steamcommunity.com/', personaState: 'online', communityVisibility: 'public',
  currentGame: { appId: 413150, name: '[DEMO] Stardew Valley' }, steamLevel: 42, gameDetailsVisible: true,
  // With a placeholder STEAM_API_KEY the live refresh fails and this cached copy is served.
  summaryFetchedAt: now, levelFetchedAt: now,
});
for (const g of games) {
  batch.set(db.doc(`users/${uid}/games/${g.appId}`), {
    appId: g.appId, name: g.name, iconHash: null, playtimeForeverMinutes: g.minutes, playtime2WeeksMinutes: g.recent,
    lastPlayedAt: g.minutes ? new Date(now.getTime() - 3 * day) : null, hasCommunityVisibleStats: g.total > 0,
    achievements: { status: g.total > 0 ? 'available' : 'none', total: g.total, unlocked: g.unlocked, syncedAt: now, syncedAtPlaytime: g.minutes },
    updatedAt: now,
  });
  batch.set(db.doc(`steamApps/${g.appId}`), { appId: g.appId, type: 'game', isFree: Boolean(g.free), name: g.name, storeStatus: 'ok', fetchedAt: now });
  batch.set(db.doc(`steamApps/${g.appId}/prices/us`), {
    appId: g.appId, region: 'us', status: g.price ? 'priced' : g.free ? 'no_price' : 'unavailable', currency: g.price ? 'USD' : null,
    initialMinor: g.price, finalMinor: g.price, discountPercent: g.price ? 0 : null, fetchedAt: now,
  });
}
for (let i = 6; i >= 0; i--) {
  const date = new Date(now.getTime() - i * day).toISOString().slice(0, 10);
  const factor = (7 - i) * 60;
  batch.set(db.doc(`users/${uid}/playtimeSnapshots/${date}`), {
    date, capturedAt: now, totalMinutes: 0,
    games: Object.fromEntries(games.filter((g) => g.minutes > 0).map((g) => [String(g.appId), Math.max(0, g.minutes - 420 + factor * (g.recent > 0 ? 1 : 0))])),
  });
}
batch.set(db.doc(`users/${uid}/gamePurchases/1091500`), { appId: 1091500, amount: 29.99, currency: 'USD', purchaseDate: '2024-06-27', source: 'steam', notes: '[DEMO] summer sale', createdAt: now, updatedAt: now });
await batch.commit();
console.log(`Seeded demo data for ${email} (uid ${uid}).`);
process.exit(0);
