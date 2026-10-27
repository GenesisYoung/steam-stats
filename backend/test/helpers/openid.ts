/** Builds a Steam-shaped OpenID positive assertion for tests. */
export function steamAssertion(returnTo: string, steamId: string, opts: { nonceTime?: Date; nonceSuffix?: string } = {}) {
  const ts = (opts.nonceTime ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const claimed = `https://steamcommunity.com/openid/id/${steamId}`;
  return {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': claimed,
    'openid.identity': claimed,
    'openid.return_to': returnTo,
    'openid.response_nonce': `${ts}${opts.nonceSuffix ?? 'abc123'}`,
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
  } as Record<string, string>;
}
