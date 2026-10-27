import { Timestamp, type DocumentData, type FirestoreDataConverter } from 'firebase-admin/firestore';

/** Recursively convert Firestore Timestamps to Dates. */
export function reviveDates<T>(value: unknown): T {
  if (value instanceof Timestamp) return value.toDate() as T;
  if (Array.isArray(value)) return value.map((v) => reviveDates(v)) as T;
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveDates(v)])) as T;
  }
  return value as T;
}

/** Typed converter: Dates are written as Timestamps natively by the Admin SDK. */
export function converter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snap) => reviveDates<T>(snap.data()),
  };
}

export const toIso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
