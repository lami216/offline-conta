import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory, sqlite, db, auth, history;
const savedEnvironment = new Map(), origin = 'http://127.0.0.1:3241';
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'alkarna-history-status-'));
  for (const [key, value] of Object.entries({ NODE_ENV: 'test', ALKARNA_DESKTOP: '1', ALKARNA_USER_DATA: join(directory, 'profile'), ALKARNA_DATABASE_PATH: join(directory, 'data.sqlite'), ALKARNA_LICENSE_STATE_PATH: join(directory, 'license.json'), ALKARNA_LICENSE_DISABLE_REGISTRY: '1', ALKARNA_TEST_LICENSE_BYPASS: '1' })) {
    savedEnvironment.set(key, process.env[key]); process.env[key] = value;
  }
  sqlite = await import('../lib/sqlite.ts'); sqlite.closeDatabase(); db = sqlite.initializeDatabase();
  auth = await import('../lib/auth.ts'); history = (await import('../app/api/history/route.ts')).GET;
});
after(async () => {
  sqlite?.closeDatabase();
  for (const [key, value] of savedEnvironment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (directory) await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.dropDatabase();
  for (const [id, permissions] of [['records', ['records.view']], ['sales', ['pos.view']]]) await db.collection('users').insertOne({ id, username: id, name: `Synthetic ${id}`, isActive: true, permissions });
  await db.collection('documents').insertMany([
    { id: 's1', number: 'S-1', kind: 'sale', status: 'posted', occurredAt: '2026-11-15T12:00:00.000Z', total: 100, lines: [] },
    { id: 's2', number: 'S-2', kind: 'sale', status: 'posted', occurredAt: '2026-11-14T12:00:00.000Z', total: 50, lines: [] },
    { id: 's3', number: 'S-3', kind: 'sale', status: 'voided', occurredAt: '2026-11-13T12:00:00.000Z', total: 20, lines: [] },
    { id: 'p1', number: 'P-1', kind: 'purchase', status: 'posted', occurredAt: '2026-11-15T11:00:00.000Z', total: 200, lines: [] },
    { id: 'p2', number: 'P-2', kind: 'purchase', status: 'voided', occurredAt: '2026-11-13T11:00:00.000Z', total: 200, lines: [] },
  ]);
});
const get = (query = '', user = 'records') => history(new Request(`${origin}/api/history?${query}`, { headers: { Host: '127.0.0.1:3241', Cookie: `conta_session=${auth.createSession({ principalType: 'user', userId: user })}` } }));

test('generic document status filters before totals and pagination and intersects kind/date without writes', async () => {
  const before = await db.collection('documents').find().toArray();
  for (const status of ['', 'all']) {
    const response = await get(`status=${status}`); assert.equal(response.status, 200);
    assert.equal((await response.json()).total, 5);
  }
  const first = await (await get('status=posted&pageSize=1')).json(), second = await (await get('status=posted&pageSize=1&page=2')).json();
  assert.deepEqual([first.total, first.totalPages, first.rows.length], [3, 3, 1]);
  assert.notEqual(first.rows[0].id, second.rows[0].id);
  assert([...first.rows, ...second.rows].every(row => row.status === 'posted'));
  const voided = await (await get('status=voided&kind=sale&from=2026-11-13&to=2026-11-13')).json();
  assert.deepEqual(voided.rows.map(row => row.id), ['s3']);
  assert.equal(voided.total, 1);
  assert.deepEqual(await db.collection('documents').find().toArray(), before);
});

test('status filtering preserves document authorization and rejects unsupported states', async () => {
  for (const [status, total] of [['posted', 2], ['voided', 1], ['all', 3]]) {
    const response = await get(`status=${status}`, 'sales'); assert.equal(response.status, 200);
    const value = await response.json(); assert.equal(value.total, total);
    assert(value.rows.every(row => row.kind === 'sale'));
  }
  assert.equal((await get('status=posted&kind=purchase', 'sales')).status, 403);
  assert.equal((await get('status=deleted')).status, 400);
  assert.equal((await get('status=POSTED')).status, 400);
});
