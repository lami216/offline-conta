import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopBackupAvailable, exportNativeBackup, openBackupFolder } from '../app/backup-export.ts';

function setGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
}

test('backup bridge detection is safe during server rendering and in a browser', t => {
  setGlobal(t, 'window', undefined);
  assert.equal(desktopBackupAvailable(), false);
  globalThis.window = {};
  assert.equal(desktopBackupAvailable(), false);
  globalThis.window.alkarnaBackup = { save: async () => ({ ok: true }) };
  assert.equal(desktopBackupAvailable(), true);
});

test('desktop export cannot report a saved backup while disk writing is still pending', async t => {
  let resolveSave, settled = false;
  const completion = new Promise(resolve => { resolveSave = resolve; });
  setGlobal(t, 'window', { alkarnaBackup: { save: () => completion } });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected browser download'); });
  const pending = exportNativeBackup('ar').then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(settled, false);
  resolveSave({ ok: true, filePath: 'C:\\Users\\Test\\AlKarna Backups\\copy.conta.json', bytes: 6000000 });
  const result = await pending;
  assert.equal(result.saved, true);
  assert.equal(result.bytes, 6000000);
  assert.match(result.filePath, /copy\.conta\.json$/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('desktop auth and disk errors are failures, not successful browser fallbacks', async t => {
  let reply;
  setGlobal(t, 'window', { alkarnaBackup: { save: async () => reply } });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected browser download'); });
  for (const status of [401, 403]) {
    reply = { ok: false, status };
    await assert.rejects(exportNativeBackup('ar'), /صلاحية/);
  }
  reply = { ok: false, code: 'ENOSPC' };
  await assert.rejects(exportNativeBackup('fr'), /Espace disque/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('desktop export requires a confirmed file path and propagates IPC rejection', async t => {
  const bridge = { save: async () => ({ ok: true }) };
  setGlobal(t, 'window', { alkarnaBackup: bridge });
  await assert.rejects(exportNativeBackup('ar'), /تعذر حفظ/);
  bridge.save = async () => { throw Error('ipc-failed'); };
  await assert.rejects(exportNativeBackup('ar'), /ipc-failed/);
});

test('browser export acknowledges only download start and releases its blob URL later', async t => {
  const calls = [];
  let cleanup;
  const link = { href: '', download: '', click: () => calls.push('click'), remove: () => calls.push('remove') };
  setGlobal(t, 'window', { setTimeout: (fn, delay) => { cleanup = fn; calls.push(`timer:${delay}`); return 1; } });
  setGlobal(t, 'document', { body: { appendChild: value => { assert.equal(value, link); calls.push('append'); } },
    createElement: name => { assert.equal(name, 'a'); return link; } });
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, '/api/settings/backup');
    return new Response('{"format":"conta-backup"}', { headers: { 'content-type': 'application/json',
      'content-disposition': 'attachment; filename="test.conta.json"' } });
  });
  t.mock.method(URL, 'createObjectURL', () => 'blob:backup-test');
  const revoke = t.mock.method(URL, 'revokeObjectURL', url => { assert.equal(url, 'blob:backup-test'); });
  const result = await exportNativeBackup('fr');
  assert.deepEqual(result, { saved: false, filePath: null });
  assert.equal(link.download, 'test.conta.json');
  assert.deepEqual(calls, ['append', 'click', 'remove', 'timer:60000']);
  assert.equal(revoke.mock.callCount(), 0);
  cleanup();
  assert.equal(revoke.mock.callCount(), 1);
});

test('browser HTTP failure does not create or initiate a download', async t => {
  setGlobal(t, 'window', {});
  setGlobal(t, 'document', { createElement: () => { throw Error('must not create link'); } });
  t.mock.method(globalThis, 'fetch', async () => new Response('denied', { status: 403 }));
  await assert.rejects(exportNativeBackup('ar'), /تعذر إنشاء/);
});

test('opening the backup folder requires an acknowledged successful main-process reply', async t => {
  setGlobal(t, 'window', {});
  await assert.rejects(openBackupFolder());
  globalThis.window.alkarnaBackup = { openFolder: async () => ({ ok: false }) };
  await assert.rejects(openBackupFolder());
  globalThis.window.alkarnaBackup.openFolder = async () => ({ ok: true });
  await assert.doesNotReject(openBackupFolder());
});
