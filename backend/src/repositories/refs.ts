import type { Firestore } from 'firebase-admin/firestore';
import type {
  AchievementSchemaDoc, AppMetadataDoc, AppPriceDoc, LinkSessionDoc, OpenIdNonceDoc, OwnedGameDoc,
  PlayerAchievementStateDoc, PlaytimeSnapshotDoc, PurchaseDoc, SteamLinkDoc, SteamProfileDoc, SyncJobDoc, UserDoc, HiddenGameDoc,
} from '@steam-analytics/shared';
import { converter } from '../lib/firestore';

/** Typed references for every Firestore path used by the backend. */
export function createRefs(db: Firestore) {
  const users = db.collection('users').withConverter(converter<UserDoc>());
  return {
    db,
    users,
    user: (uid: string) => users.doc(uid),
    steamProfile: (uid: string) => db.doc(`users/${uid}/steamProfile/current`).withConverter(converter<SteamProfileDoc>()),
    games: (uid: string) => db.collection(`users/${uid}/games`).withConverter(converter<OwnedGameDoc>()),
    game: (uid: string, appId: number) => db.doc(`users/${uid}/games/${appId}`).withConverter(converter<OwnedGameDoc>()),
    hiddenGames: (uid: string) => db.collection(`users/${uid}/hiddenGames`).withConverter(converter<HiddenGameDoc>()),
    hiddenGame: (uid: string, appId: number) => db.doc(`users/${uid}/hiddenGames/${appId}`).withConverter(converter<HiddenGameDoc>()),
    achievementState: (uid: string, appId: number) =>
      db.doc(`users/${uid}/games/${appId}/achievements/state`).withConverter(converter<PlayerAchievementStateDoc>()),
    purchases: (uid: string) => db.collection(`users/${uid}/gamePurchases`).withConverter(converter<PurchaseDoc>()),
    purchase: (uid: string, appId: number) => db.doc(`users/${uid}/gamePurchases/${appId}`).withConverter(converter<PurchaseDoc>()),
    snapshots: (uid: string) => db.collection(`users/${uid}/playtimeSnapshots`).withConverter(converter<PlaytimeSnapshotDoc>()),
    syncJobs: (uid: string) => db.collection(`users/${uid}/syncJobs`).withConverter(converter<SyncJobDoc>()),
    steamLink: (steamId: string) => db.doc(`steamLinks/${steamId}`).withConverter(converter<SteamLinkDoc>()),
    linkSession: (id: string) => db.doc(`linkSessions/${id}`).withConverter(converter<LinkSessionDoc>()),
    nonce: (id: string) => db.doc(`openidNonces/${id}`).withConverter(converter<OpenIdNonceDoc>()),
    appMeta: (appId: number) => db.doc(`steamApps/${appId}`).withConverter(converter<AppMetadataDoc>()),
    appPrice: (appId: number, region: string) => db.doc(`steamApps/${appId}/prices/${region}`).withConverter(converter<AppPriceDoc>()),
    appSchema: (appId: number, lang: string) => db.doc(`steamApps/${appId}/schemas/${lang}`).withConverter(converter<AchievementSchemaDoc>()),
  };
}

export type Refs = ReturnType<typeof createRefs>;
