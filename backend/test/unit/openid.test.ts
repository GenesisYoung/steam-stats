import { describe, expect, it } from 'vitest';
import { buildLoginUrl, checkAssertion, extractOpenIdParams, verifyWithSteam } from '../../src/services/openIdService';
import { FakeSteam } from '../helpers/fakeSteam';
import { steamAssertion } from '../helpers/openid';

const RETURN_TO = 'https://app.example.com/api/steam/callback?state=abc';
const STEAM_ID = '76561198000000001';

describe('buildLoginUrl', () => {
  it('builds an identifier_select checkid_setup request', () => {
    const url = new URL(buildLoginUrl(RETURN_TO, 'https://app.example.com'));
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login');
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(url.searchParams.get('openid.return_to')).toBe(RETURN_TO);
    expect(url.searchParams.get('openid.realm')).toBe('https://app.example.com');
    expect(url.searchParams.get('openid.claimed_id')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
  });
});

describe('checkAssertion', () => {
  it('accepts a valid assertion and extracts the SteamID64', () => {
    const r = checkAssertion(steamAssertion(RETURN_TO, STEAM_ID), RETURN_TO);
    expect(r).toMatchObject({ ok: true, steamId: STEAM_ID });
  });

  it('detects cancellation', () => {
    expect(checkAssertion({ 'openid.mode': 'cancel' }, RETURN_TO)).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('rejects a different return_to (session mix-up)', () => {
    const p = steamAssertion('https://app.example.com/api/steam/callback?state=other', STEAM_ID);
    expect(checkAssertion(p, RETURN_TO)).toEqual({ ok: false, reason: 'return_to_mismatch' });
  });

  it('rejects a foreign OP endpoint', () => {
    const p = { ...steamAssertion(RETURN_TO, STEAM_ID), 'openid.op_endpoint': 'https://evil.example/openid/login' };
    expect(checkAssertion(p, RETURN_TO)).toEqual({ ok: false, reason: 'invalid_response' });
  });

  it('rejects mismatching claimed_id / identity and non-Steam identities', () => {
    const a = { ...steamAssertion(RETURN_TO, STEAM_ID), 'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000002' };
    expect(checkAssertion(a, RETURN_TO).ok).toBe(false);
    const b = steamAssertion(RETURN_TO, STEAM_ID);
    b['openid.claimed_id'] = b['openid.identity'] = 'https://evil.example/openid/id/76561198000000001';
    expect(checkAssertion(b, RETURN_TO).ok).toBe(false);
  });

  it('rejects stale nonces (replay window)', () => {
    const p = steamAssertion(RETURN_TO, STEAM_ID, { nonceTime: new Date(Date.now() - 10 * 60 * 1000) });
    expect(checkAssertion(p, RETURN_TO)).toEqual({ ok: false, reason: 'stale_nonce' });
  });

  it('rejects assertions that do not sign the critical fields', () => {
    const p = { ...steamAssertion(RETURN_TO, STEAM_ID), 'openid.signed': 'signed,op_endpoint,claimed_id' };
    expect(checkAssertion(p, RETURN_TO)).toEqual({ ok: false, reason: 'invalid_response' });
  });
});

describe('extractOpenIdParams', () => {
  it('rejects duplicated parameters', () => {
    expect(extractOpenIdParams({ 'openid.mode': ['id_res', 'id_res'] })).toBeNull();
    expect(extractOpenIdParams({ 'openid.mode': 'id_res', state: 'x' })).toEqual({ 'openid.mode': 'id_res' });
  });
});

describe('verifyWithSteam', () => {
  it('returns valid / invalid / unavailable', async () => {
    const steam = new FakeSteam();
    const params = steamAssertion(RETURN_TO, STEAM_ID);
    expect(await verifyWithSteam(params, steam.fetch)).toBe('valid');
    steam.openIdValid = false;
    expect(await verifyWithSteam(params, steam.fetch)).toBe('invalid');
    const failing = async () => { throw new TypeError('network down'); };
    expect(await verifyWithSteam(params, failing as never)).toBe('unavailable');
  });
});
