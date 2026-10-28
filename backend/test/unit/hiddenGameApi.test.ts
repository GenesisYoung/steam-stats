import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import type { Container } from '../../src/container';
import { errors } from '../../src/lib/errors';

function setup() {
  const set = vi.fn(async (_uid: string, _appId: number, _input: unknown) => {});
  const invalidate = vi.fn();
  const detail = vi.fn(async () => ({ appId: 10, hidden: true, excludedFromStats: true }));
  const app = createApp({
    env: { PUBLIC_API_URL: 'http://localhost:5173', PUBLIC_APP_URL: 'http://localhost:5173', TRUST_PROXY: 0, CORS_ORIGINS: [] },
    auth: { verifyIdToken: async (token: string) => {
      if (token !== 'alice' && token !== 'bob') throw Error('Invalid session');
      return { uid: token, email: `${token}@example.test`, email_verified: true, auth_time: 1 };
    } },
    hiddenGames: { set }, library: { invalidate, detail },
  } as unknown as Container);
  return { app, set, invalidate, detail };
}

describe('game visibility API', () => {
  it('requires a valid session before changing any preferences', async () => {
    const { app, set } = setup();
    await request(app).patch('/api/steam/games/10/visibility').send({ hidden: true }).expect(401);
    await request(app).patch('/api/steam/games/10/visibility').set('Authorization', 'Bearer invalid').send({ hidden: true }).expect(401);
    expect(set).not.toHaveBeenCalled();
  });

  it('uses the authenticated user and validates the AppID and body before saving', async () => {
    const { app, set, invalidate } = setup();
    const res = await request(app).patch('/api/steam/games/10/visibility').set('Authorization', 'Bearer alice').send({ hidden: true }).expect(200);
    expect(res.body.data).toMatchObject({ appId: 10, hidden: true, excludedFromStats: true });
    expect(set).toHaveBeenCalledWith('alice', 10, { hidden: true, excludeFromStats: true });
    expect(invalidate).toHaveBeenCalledWith('alice');
    set.mockClear();
    for (const body of [{ hidden: 'true' }, { hidden: true, uid: 'bob' }, { hidden: true, playtimeForeverMinutes: 0 }]) {
      await request(app).patch('/api/steam/games/10/visibility').set('Authorization', 'Bearer alice').send(body).expect(400);
    }
    await request(app).patch('/api/steam/games/invalid/visibility').set('Authorization', 'Bearer alice').send({ hidden: true }).expect(400);
    expect(set).not.toHaveBeenCalled();
  });

  it('does not invalidate data or return success if saving fails', async () => {
    const { app, set, invalidate, detail } = setup();
    set.mockRejectedValueOnce(errors.notFound('Game not found in your library'));
    await request(app).patch('/api/steam/games/10/visibility').set('Authorization', 'Bearer bob').send({ hidden: true }).expect(404);
    expect(set).toHaveBeenCalledWith('bob', 10, { hidden: true, excludeFromStats: true });
    expect(invalidate).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });
});
