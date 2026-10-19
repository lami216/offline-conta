/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs/promises');
const { createWriteStream, constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Destination selection belongs to a trusted app-owned picker, never Windows Shell.
// chooseDestination is supplied by the main process, not a renderer IPC argument.
function createBackupStore({ homeDirectory, chooseDestination, log = () => {}, timeoutMs = 120000 }) {
  if (!path.isAbsolute(homeDirectory)) throw new Error('invalid-backup-directory');
  const directory = path.join(homeDirectory, 'AlKarna Backups');
  let active = null, lastFilePath = null;
  function save(fetchResponse) {
    if (active) return active;
    const task = write(fetchResponse);
    active = task;
    void task.then(() => { if (active === task) active = null; }, () => { if (active === task) active = null; });
    return task;
  }
  async function write(fetchResponse) {
    let temporaryPath, filePath;
    let published = false, createdFinal = false;
    let bytes = 0;
    try {
      const selection = chooseDestination ? await chooseDestination() : undefined;
      if (chooseDestination && !selection) return { ok: false, canceled: true };
      if (selection) {
        filePath = selection.filePath;
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !/\.conta\.json$/i.test(filePath)) throw new Error('invalid-backup-destination');
        // Do not recreate the mount point when a selected USB drive is removed.
        if (!(await fs.stat(path.dirname(filePath))).isDirectory()) throw new Error('invalid-backup-directory');
      } else {
        filePath = path.join(directory, `AlKarna-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.conta.json`);
      }
      const signal = AbortSignal.timeout(timeoutMs); // User selection has no download timeout.
      log('backup start');
      const response = await fetchResponse(signal);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const error = new Error('backup-http-error'); error.status = response.status; throw error;
      }
      if (!/^application\/json\b/i.test(response.headers.get('content-type') || '') || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error('invalid-backup-response');
      }
      if (!selection) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      temporaryPath = `${filePath}.${randomUUID()}.partial`;
      log('backup response ready; writing temporary file');
      const counter = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; done(null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), counter,
        createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600, flush: true }), { signal });
      const declared = response.headers.get('content-length');
      const encoded = response.headers.get('content-encoding');
      if (!bytes || (!encoded && declared !== null && /^\d+$/.test(declared) && bytes !== Number(declared))) throw new Error('incomplete-backup-response');
      try { await fs.link(temporaryPath, filePath); createdFinal = true; }
      catch (error) {
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EISDIR'].includes(error.code)) throw error;
        // Windows may map an unsupported exFAT hard link to EISDIR (node#65817).
        // COPYFILE_EXCL also refuses real existing directories and files safely.
        // FAT32/exFAT USB media do not support hard links. Exclusively copy the
        // completed temporary file, then flush it before acknowledging success.
        await fs.copyFile(temporaryPath, filePath, constants.COPYFILE_EXCL);
        createdFinal = true;
        const handle = await fs.open(filePath, 'r+');
        try { await handle.sync(); } finally { await handle.close(); }
      }
      published = true;
      lastFilePath = filePath;
      await fs.unlink(temporaryPath).catch(error => log(`backup temporary cleanup failed: ${error.code || 'unknown'}`));
      log(`backup saved bytes=${bytes} path=${filePath}`);
      return { ok: true, filePath, bytes };
    } catch (error) {
      if (!published && createdFinal) await fs.rm(filePath, { force: true }).catch(() => {});
      if (!published && temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => {});
      log(`backup failed code=${error.code || error.message || 'unknown'}`);
      throw error;
    }
  }
  return { directory, save, lastFilePath: () => lastFilePath, isActive: () => active !== null, waitForIdle: () => active || Promise.resolve() };
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
        // Keep the normal capability/license-gated route and this user's session.
        return fetchResponse(url, { signal, cache: 'no-store', redirect: 'error',
          headers: { cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '), 'accept-encoding': 'identity' } });
      });
      if (result.ok) hasSaved = true;
      return result;
    } catch (error) { return backupErrorResult(error); }
  });
  ipcMain.handle('alkarna:backup:open-folder', async event => {
    if (!trusted(event) || !hasSaved) return { ok: false, error: 'forbidden' };
    try {
      const target = store.lastFilePath?.();
      const error = await openPath(target ? path.dirname(target) : store.directory);
      return error ? { ok: false, error: 'open-backup-folder-failed' } : { ok: true };
    } catch { return { ok: false, error: 'open-backup-folder-failed' }; }
  });
}
module.exports = { createBackupStore, isTrustedBackupSender, backupErrorResult, registerBackupHandlers };
