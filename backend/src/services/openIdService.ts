/**
 * Steam OpenID 2.0 (https://steamcommunity.com/openid/) relying-party logic.
 *
 * Validation steps for a positive assertion:
 *  1. openid.mode === "id_res" (or "cancel" → user aborted)
 *  2. namespace and OP endpoint are Steam's
 *  3. return_to exactly matches the URL we generated for this linking session
 *  4. claimed_id === identity and is a Steam identity URL with a SteamID64
 *  5. response_nonce is present, well-formed and fresh (replay window)
 *  6. all security-relevant fields are covered by the signature
 *  7. Steam confirms the signature via check_authentication (direct verification)
 * Nonce single-use is enforced by the caller in a Firestore transaction.
 */
import { request, type FetchLike } from '../lib/http';

export const STEAM_OP_ENDPOINT = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
const NONCE_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)./;
const REQUIRED_SIGNED = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'];
export const NONCE_MAX_AGE_MS = 5 * 60 * 1000;

export type OpenIdFailure =
  | 'cancelled'
  | 'invalid_response'
  | 'return_to_mismatch'
  | 'stale_nonce'
  | 'verification_failed'
  | 'steam_unavailable';

export type AssertionCheck =
  | { ok: true; steamId: string; nonce: string; params: Record<string, string> }
  | { ok: false; reason: OpenIdFailure };

export function buildLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  return `${STEAM_OP_ENDPOINT}?${params}`;
}

/** Extracts openid.* params; rejects duplicated (array) values. */
export function extractOpenIdParams(query: Record<string, unknown>): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('openid.')) continue;
    if (typeof v !== 'string') return null;
    out[k] = v;
  }
  return out;
}

/** Local (offline) checks of a Steam assertion. */
export function checkAssertion(params: Record<string, string>, expectedReturnTo: string, now = Date.now()): AssertionCheck {
  const p = (k: string) => params[`openid.${k}`];
  if (p('mode') === 'cancel') return { ok: false, reason: 'cancelled' };
  if (p('mode') !== 'id_res' || p('ns') !== OPENID_NS) return { ok: false, reason: 'invalid_response' };
  if (p('op_endpoint') !== STEAM_OP_ENDPOINT) return { ok: false, reason: 'invalid_response' };
  if (p('return_to') !== expectedReturnTo) return { ok: false, reason: 'return_to_mismatch' };

  const claimed = p('claimed_id');
  const match = claimed ? CLAIMED_ID_RE.exec(claimed) : null;
  if (!match || p('identity') !== claimed) return { ok: false, reason: 'invalid_response' };

  const nonce = p('response_nonce');
  const nonceMatch = nonce ? NONCE_RE.exec(nonce) : null;
  if (!nonce || !nonceMatch) return { ok: false, reason: 'invalid_response' };
  const issuedAt = Date.parse(nonceMatch[1]!);
  if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > NONCE_MAX_AGE_MS) return { ok: false, reason: 'stale_nonce' };

  const signed = (p('signed') ?? '').split(',');
  if (!p('sig') || !REQUIRED_SIGNED.every((f) => signed.includes(f))) return { ok: false, reason: 'invalid_response' };

  return { ok: true, steamId: match[1]!, nonce, params };
}

/** Direct verification with Steam (OpenID 2.0 §11.4.2). */
export async function verifyWithSteam(params: Record<string, string>, fetchImpl?: FetchLike): Promise<'valid' | 'invalid' | 'unavailable'> {
  const body = new URLSearchParams({ ...params, 'openid.mode': 'check_authentication' });
  try {
    const { text } = await request(STEAM_OP_ENDPOINT, {
      service: 'steam-openid',
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' },
      fetchImpl,
      retries: 2,
      timeoutMs: 10_000,
    });
    const fields = Object.fromEntries(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const i = line.indexOf(':');
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    );
    return fields.ns === OPENID_NS && fields.is_valid === 'true' ? 'valid' : 'invalid';
  } catch {
    return 'unavailable';
  }
}
