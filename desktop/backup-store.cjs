/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// A file-picker must never be needed to obtain a recovery copy. In particular,
// do not enumerate Downloads, Quick Access, cloud providers or shell extensions.
function createBackupStore({ homeDirectory, log = () => {}, timeoutMs = 120000 }) {
  if (!path.isAbsolute(homeDirectory)) throw new Error('invalid-backup-directory');
  const directory = path.join(homeDirectory, 'AlKarna Backups');
  let active = null;
  function save(fetchResponse) {
    if (active) return active;
    const task = write(fetchResponse);
    active = task;
    void task.then(() => { if (active === task) active = null; }, () => { if (active === task) active = null; });
    return task;
  }
  async function write(fetchResponse) {
    const signal = AbortSignal.timeout(timeoutMs);
    let temporaryPath;
    let published = false;
    let bytes = 0;
    try {
      log('backup start');
      // The caller supplies the fixed, authorized endpoint, never the renderer.
      const response = await fetchResponse(signal);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const error = new Error('backup-http-error');
        error.status = response.status;
        throw error;
      }
      if (!/^application\/json\b/i.test(response.headers.get('content-type') || '') || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error('invalid-backup-response');
      }
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const filename = `AlKarna-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.conta.json`;
      const filePath = path.join(directory, filename);
      temporaryPath = `${filePath}.partial`;
      log('backup response ready; writing temporary file');
      const counter = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; done(null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), counter,
        createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600, flush: true }), { signal });
      const declared = response.headers.get('content-length');
      const encoded = response.headers.get('content-encoding');
      if (!bytes || (!encoded && declared !== null && /^\d+$/.test(declared) && bytes !== Number(declared))) {
        throw new Error('incomplete-backup-response');
      }
      // Unique names plus exclusive publication: never replace an earlier backup.
      // Both files are on the same local filesystem (NTFS on supported Windows).
      await fs.link(temporaryPath, filePath);
      published = true;
      await fs.unlink(temporaryPath).catch(error => log(`backup temporary cleanup failed: ${error.code || 'unknown'}`));
      log(`backup saved bytes=${bytes} path=${filePath}`);
      return { ok: true, filePath, bytes };
    } catch (error) {
      if (!published && temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => {});
      log(`backup failed code=${error.code || error.message || 'unknown'}`);
      throw error;
    }
  }
  return { directory, save, isActive: () => active !== null, waitForIdle: () => active || Promise.resolve() };
}

function isTrustedBackupSender(event, owner, origin) {
  try {
    return !!owner && !owner.isDestroyed() && event.sender === owner.webContents &&
      !!event.senderFrame && event.senderFrame === owner.webContents.mainFrame &&
      new URL(event.senderFrame.url).origin === new URL(origin).origin;
  } catch { return false; }
}

function backupErrorResult(error) {
  return { ok: false, error: 'backup-save-failed', code: error?.code || error?.message || 'unknown', status: error?.status || null };
}
function registerBackupHandlers({ ipcMain, store, getWindow, getOrigin, fetchResponse, openPath, isClosing = () => false }) {
  let hasSaved = false;
  const trusted = event => isTrustedBackupSender(event, getWindow(), getOrigin());
  ipcMain.handle('alkarna:backup:save', async event => {
    if (!trusted(event)) return { ok: false, error: 'forbidden', status: 403 };
    if (isClosing() || store.isActive()) return { ok: false, error: 'backup-busy', code: 'backup-busy' };
    const url = new URL('/api/settings/backup', getOrigin()).href;
    try {
      const result = await store.save(async signal => {
        const cookies = await event.sender.session.cookies.get({ url });
        // Use the normal capability/license-gated route with this window's session.
        // The privileged desktop backup token is intentionally not used here.
        return fetchResponse(url, { signal, cache: 'no-store', redirect: 'error',
          headers: { cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '), 'accept-encoding': 'identity' } });
      });
      hasSaved = true;
      return result;
    } catch (error) { return backupErrorResult(error); }
  });
  ipcMain.handle('alkarna:backup:open-folder', async event => {
    if (!trusted(event) || !hasSaved) return { ok: false, error: 'forbidden' };
    try {
      const error = await openPath(store.directory);
      return error ? { ok: false, error: 'open-backup-folder-failed' } : { ok: true };
    } catch { return { ok: false, error: 'open-backup-folder-failed' }; }
  });
}
module.exports = { createBackupStore, isTrustedBackupSender, backupErrorResult, registerBackupHandlers };
