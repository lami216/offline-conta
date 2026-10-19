import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createBackupStore, isTrustedBackupSender } = require('../desktop/backup-store.cjs');
async function fixture(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'alkarna-backup-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, store: createBackupStore({ homeDirectory: home, ...options }) };
}
const jsonResponse = value => new Response(value, { headers: { 'content-type': 'application/json' } });
test('writes an empty-database JSON exactly without a native dialog or changing the input', async t => {
  const { store } = await fixture(t);
  const data = JSON.stringify({ format: 'conta-backup', schemaVersion: 1, collections: { documents: [] } });
  const result = await store.save(async () => jsonResponse(data));
  assert.equal(result.ok, true);
  assert.equal(await readFile(result.filePath, 'utf8'), data);
  assert.equal(result.bytes, Buffer.byteLength(data));
  assert.equal((await readdir(store.directory)).length, 1);
  assert.match(result.filePath, /\.conta\.json$/);
});
test('streams a backup larger than 5 MiB without a renderer blob or size cap', async t => {
  const { store } = await fixture(t);
  const data = JSON.stringify({ format: 'conta-backup', note: 'ع'.repeat(4 * 1024 * 1024) });
  const result = await store.save(async () => jsonResponse(data));
  assert.ok(result.bytes > 5 * 1024 * 1024);
  assert.equal(await readFile(result.filePath, 'utf8'), data);
});
test('does not acknowledge save before the stream completes and coalesces repeated requests', async t => {
  const { store } = await fixture(t);
  let controller, fetched = 0, complete = false;
  const stream = new ReadableStream({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('{')); } });
  const first = store.save(async () => { fetched++; return jsonResponse(stream); });
  const second = store.save(async () => { fetched++; return jsonResponse('{}'); });
  assert.equal(first, second);
  first.then(() => { complete = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(complete, false);
  assert.equal(store.isActive(), true);
  controller.enqueue(new TextEncoder().encode('}')); controller.close();
  await first;
  assert.equal(fetched, 1);
  assert.equal(store.isActive(), false);
});
test('HTTP permission and license failures never become successful backup files', async t => {
  const { store } = await fixture(t);
  for (const status of [401, 403, 402, 500]) {
    await assert.rejects(store.save(async () => new Response('denied', { status })), error => error.status === status);
  }
  assert.equal(store.isActive(), false);
  await assert.rejects(readdir(store.directory), { code: 'ENOENT' });
});
test('HTML and empty responses fail and leave no final or partial files', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.save(async () => new Response('<html>error</html>')), /invalid-backup-response/);
  await assert.rejects(store.save(async () => jsonResponse('')), /incomplete-backup-response/);
  assert.deepEqual(await readdir(store.directory), []);
});
test('failed streams preserve previous backups and clean partial output', async t => {
  const { store } = await fixture(t);
  const good = await store.save(async () => jsonResponse('{"ok":true}'));
  const broken = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([123])); c.error(new Error('read-failed')); } });
  await assert.rejects(store.save(async () => jsonResponse(broken)), /read-failed/);
  assert.equal(await readFile(good.filePath, 'utf8'), '{"ok":true}');
  assert.deepEqual(await readdir(store.directory), [good.filePath.split(/[\\/]/).at(-1)]);
});
test('content-length mismatch rejects a truncated backup', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.save(async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '10' } })), /incomplete-backup-response/);
  assert.deepEqual(await readdir(store.directory), []);
});
test('network/stream timeout rejects, clears busy state, and cleans temporary output', async t => {
  const { store } = await fixture(t, { timeoutMs: 40 });
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([123])); } });
  const keeper = setInterval(() => {}, 20);
  try { await assert.rejects(store.save(async () => jsonResponse(stream)), /abort/i); }
  finally { clearInterval(keeper); }
  assert.equal(store.isActive(), false);
  assert.deepEqual(await readdir(store.directory), []);
});
test('directory write failure reports failure rather than success', async t => {
  const { home, store } = await fixture(t);
  await writeFile(join(home, 'AlKarna Backups'), 'not a directory');
  await assert.rejects(store.save(async () => jsonResponse('{}')));
  assert.equal(await readFile(join(home, 'AlKarna Backups'), 'utf8'), 'not a directory');
});
test('back-to-back saves use different filenames and retain all earlier backups', async t => {
  const { store } = await fixture(t);
  const a = await store.save(async () => jsonResponse('{"n":1}'));
  const b = await store.save(async () => jsonResponse('{"n":2}'));
  assert.notEqual(a.filePath, b.filePath);
  assert.equal(await readFile(a.filePath, 'utf8'), '{"n":1}');
  assert.equal(await readFile(b.filePath, 'utf8'), '{"n":2}');
});
test('IPC only trusts the app main frame at the exact local server origin', () => {
  const frame = { url: 'http://127.0.0.1:12345/' };
  const owner = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: owner.webContents, senderFrame: frame };
  assert.equal(isTrustedBackupSender(event, owner, frame.url), true);
  assert.equal(isTrustedBackupSender({ ...event, senderFrame: { ...frame } }, owner, frame.url), false);
  assert.equal(isTrustedBackupSender({ ...event, sender: {} }, owner, frame.url), false);
  assert.equal(isTrustedBackupSender(event, owner, 'http://127.0.0.1:9999/'), false);
  assert.equal(isTrustedBackupSender(event, null, frame.url), false);
  frame.url = 'https://example.com/';
  assert.equal(isTrustedBackupSender(event, owner, 'http://127.0.0.1:12345/'), false);
});

test('manual desktop IPC uses session cookies, fixed normal backup endpoint and ignores supplied paths', async t => {
  const { store } = await fixture(t);
  const { registerBackupHandlers } = require('../desktop/backup-store.cjs');
  const handlers = new Map(); let fetched;
  const frame = { url: 'http://127.0.0.1:12000/' };
  const owner = { isDestroyed: () => false, webContents: { mainFrame: frame,
    session: { cookies: { get: async () => [{ name: 'conta_session', value: 'test-session' }] } } } };
  const event = { sender: owner.webContents, senderFrame: frame };
  let opened;
  registerBackupHandlers({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, store,
    getWindow: () => owner, getOrigin: () => frame.url,
    fetchResponse: async (url, options) => { fetched = { url, options }; return jsonResponse('{}'); },
    openPath: async directory => { opened = directory; return ''; } });
  assert.equal((await handlers.get('alkarna:backup:open-folder')(event)).ok, false);
  const reply = await handlers.get('alkarna:backup:save')(event, { path: '/attacker.json', url: 'https://example.com' });
  assert.equal(reply.ok, true);
  assert.equal(fetched.url, 'http://127.0.0.1:12000/api/settings/backup');
  assert.equal(fetched.options.headers.cookie, 'conta_session=test-session');
  assert.equal(fetched.options.headers['x-alkarna-desktop-token'], undefined);
  assert.equal(fetched.options.redirect, 'error');
  assert.equal((await handlers.get('alkarna:backup:open-folder')(event, '/etc')).ok, true);
  assert.equal(opened, store.directory);
});
test('IPC rejects external frames and does not report permission failure as saved', async t => {
  const { store } = await fixture(t);
  const { registerBackupHandlers } = require('../desktop/backup-store.cjs');
  const handlers = new Map(); let calls = 0;
  const frame = { url: 'http://127.0.0.1:12000/' };
  const owner = { isDestroyed: () => false, webContents: { mainFrame: frame,
    session: { cookies: { get: async () => [] } } } };
  registerBackupHandlers({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, store,
    getWindow: () => owner, getOrigin: () => frame.url,
    fetchResponse: async () => { calls++; return new Response('denied', { status: 403 }); }, openPath: async () => '' });
  assert.equal((await handlers.get('alkarna:backup:save')({ sender: {}, senderFrame: frame })).ok, false);
  assert.equal(calls, 0);
  const reply = await handlers.get('alkarna:backup:save')({ sender: owner.webContents, senderFrame: frame });
  assert.equal(reply.ok, false); assert.equal(reply.status, 403);
  assert.equal(calls, 1);
});
