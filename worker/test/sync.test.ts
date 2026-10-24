import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const BASE = 'https://example.com/api/sync';
const stats = { abc123: { c: 2, w: 1, h: '101', t: 1700000000000 } };

function call(path: string, init?: RequestInit) {
  return exports.default.fetch(new Request(BASE + path, init));
}

function put(code: string, device: string, body: unknown) {
  return call(`/${code}/${device}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

describe('sync API', () => {
  it('returns no devices for an unused code', async () => {
    const res = await call('/ABCD-EFGH-JKMN');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ devices: {} });
  });

  it('stores each device separately and returns all of them', async () => {
    expect((await put('ABCDEFGHJKMN', 'phone1', { name: 'Phone', stats })).status).toBe(200);
    const res = await put('abcd-efgh-jkmn', 'tablet1', { name: 'Tablet', stats: {} });
    const { devices } = await res.json<{ devices: Record<string, { name: string; stats: unknown }> }>();
    expect(Object.keys(devices).sort()).toEqual(['phone1', 'tablet1']);
    expect(devices.phone1.stats).toEqual(stats);
    expect(devices.tablet1.name).toBe('Tablet');
  });

  it('updates a device in place', async () => {
    await put('ABCDEFGHJKMP', 'dev1', { name: 'A', stats: {} });
    await put('ABCDEFGHJKMP', 'dev1', { name: 'B', stats });
    const { devices } = await (await call('/ABCDEFGHJKMP')).json<{ devices: Record<string, { name: string }> }>();
    expect(Object.keys(devices)).toEqual(['dev1']);
    expect(devices.dev1.name).toBe('B');
  });

  it('treats O as 0 and I or L as 1 in codes', async () => {
    await put('0000111100AB', 'dev1', { stats });
    const { devices } = await (await call('/OOOOILIL00AB')).json<{ devices: object }>();
    expect(Object.keys(devices)).toEqual(['dev1']);
  });

  it('rejects invalid codes, device ids and bodies', async () => {
    expect((await call('/SHORT')).status).toBe(400);
    expect((await put('ABCDEFGHJKMR', 'Bad_Id!', { stats })).status).toBe(400);
    expect((await put('ABCDEFGHJKMR', 'dev1', { stats: { q: { c: -1, w: 0, h: '', t: 0 } } })).status).toBe(400);
    expect((await put('ABCDEFGHJKMR', 'dev1', { stats: { q: { c: 1, w: 0, h: 'xx', t: 0 } } })).status).toBe(400);
    expect((await put('ABCDEFGHJKMR', 'dev1', { name: 'x'.repeat(41), stats })).status).toBe(400);
    const bad = await call('/ABCDEFGHJKMR/dev1', { method: 'PUT', body: '{not json' });
    expect(bad.status).toBe(400);
  });

  it('stores language preferences per device', async () => {
    const prefs = { uiLang: 'zh-Hant', secondLang: 'en', questionLang: 'zh-Hant', updated: 1700000000000 };
    await put('ABCDEFGHJKMW', 'dev1', { stats, prefs });
    await put('ABCDEFGHJKMW', 'dev2', { stats: {} }); // an older app sends no prefs
    const { devices } = await (await call('/ABCDEFGHJKMW')).json<{ devices: Record<string, { prefs: unknown }> }>();
    expect(devices.dev1.prefs).toEqual(prefs);
    expect(devices.dev2.prefs).toEqual({});
  });

  it('rejects invalid language preferences', async () => {
    expect((await put('ABCDEFGHJKMX', 'dev1', { stats, prefs: 'en' })).status).toBe(400);
    expect((await put('ABCDEFGHJKMX', 'dev1', { stats, prefs: { uiLang: '<script>' } })).status).toBe(400);
    expect((await put('ABCDEFGHJKMX', 'dev1', { stats, prefs: { updated: -1 } })).status).toBe(400);
  });

  it('rejects oversized bodies', async () => {
    const big = { stats, pad: 'x'.repeat(300_000) };
    expect((await put('ABCDEFGHJKMS', 'dev1', big)).status).toBe(413);
  });

  it('limits devices per code', async () => {
    for (let i = 0; i < 10; i++) expect((await put('ABCDEFGHJKMT', `dev${i}x`, { stats: {} })).status).toBe(200);
    expect((await put('ABCDEFGHJKMT', 'dev99x', { stats: {} })).status).toBe(409);
    expect((await put('ABCDEFGHJKMT', 'dev0x', { stats })).status).toBe(200);
  });

  it('rejects unsupported methods and unknown API paths', async () => {
    expect((await call('/ABCDEFGHJKMV', { method: 'POST' })).status).toBe(405);
    expect((await call('/ABCDEFGHJKMV/dev1', { method: 'DELETE' })).status).toBe(405);
    expect((await call('/ABCDEFGHJKMV/dev1/extra')).status).toBe(404);
    expect((await exports.default.fetch(new Request('https://example.com/api/other'))).status).toBe(404);
  });

  it('reports the features of this deployment', async () => {
    const res = await exports.default.fetch(new Request('https://example.com/api/config'));
    expect(res.status).toBe(200);
    // The tests run with the top-level (production) settings.
    expect(await res.json()).toEqual({ environment: 'production', gistSync: false });
  });

  it('serves the app for other paths', async () => {
    const res = await exports.default.fetch(new Request('https://example.com/index.html'));
    expect(res.status).toBe(200);
  });
});
