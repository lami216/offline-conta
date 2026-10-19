/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');

const CHANNEL = 'alkarna:backup-picker';
function fail(code) { return Object.assign(new Error(code), { code }); }
function folderPath(value, platform = process.platform) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\x00-\x1f]/.test(value)) throw fail('invalid-path');
  const p = platform === 'win32' ? path.win32 : path.posix;
  const input = value.trim();
  // No device paths, alternate streams, or implicit drive-relative paths.
  if (platform === 'win32' && (!/^[a-z]:[\\/]/i.test(input) || /[:<>"|?*]/.test(input.slice(2)))) throw fail('invalid-path');
  if (!p.isAbsolute(input)) throw fail('invalid-path');
  return p.normalize(input);
}
function entryName(value) {
  if (typeof value !== 'string') throw fail('invalid-name');
  const name = value.trim();
  if (!name || name.length > 160 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)) throw fail('invalid-name');
  return name;
}
function backupName(value) {
  let name = entryName(value);
  if (/\.conta\.json$/i.test(name)) return name;
  if (/\.json$/i.test(name)) name = name.slice(0, -5);
  if (/\.conta$/i.test(name)) name = name.slice(0, -6);
  return entryName(`${name}.conta.json`);
}
function deadline(task, ms = 8000) {
  let timer;
  return Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(fail('folder-timeout')), ms); })]).finally(() => clearTimeout(timer));
}
async function listDirectory(input, query = '') {
  const directory = folderPath(input);
  const needle = String(query).slice(0, 100).toLocaleLowerCase();
  const entries = [];
  let truncated = false;
  // No shell namespace, thumbnails, icons, Quick Access or cloud-provider calls.
  const handle = await fs.opendir(directory);
  for await (const item of handle) {
    if (needle && !item.name.toLocaleLowerCase().includes(needle)) continue;
    if (!item.isDirectory() && !(item.isFile() && /\.conta\.json$/i.test(item.name))) continue;
    if (entries.length === 1000) { truncated = true; break; }
    entries.push({ name: item.name, directory: item.isDirectory() });
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { directory, parent: path.dirname(directory), entries, truncated };
}
async function resolveDestination(directory, filename) {
  const dir = folderPath(directory);
  if (!(await fs.stat(dir)).isDirectory()) throw fail('ENOTDIR');
  const filePath = path.join(dir, backupName(filename));
  try { await fs.lstat(filePath); } catch (error) { if (error.code === 'ENOENT') return { filePath }; throw error; }
  // Never overwrite an earlier recovery copy; the user can choose another name.
  throw fail('EEXIST');
}
function drives(platform = process.platform) {
  if (platform !== 'win32') return Promise.resolve([{ name: '/', path: '/' }]);
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // A fixed command, no user text, no shell and no drive-content enumeration.
  return new Promise(resolve => execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '[System.IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name }'], { windowsHide: true, timeout: 4000, maxBuffer: 8192 }, (error, stdout) => {
    const names = error ? [] : String(stdout).split(/\r?\n/).map(s => s.trim()).filter(s => /^[A-Z]:\\$/i.test(s));
    // Even with PowerShell unavailable, every possible USB letter remains selectable.
    const roots = names.length ? names : Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`);
    resolve(roots.map(root => ({ name: root, path: root })));
  }));
}
function trustedPicker(event, window, expectedUrl) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === expectedUrl;
}
function createBackupPicker({ BrowserWindow, ipcMain, getOwner, homeDirectory, getLocale = async () => 'ar', log = () => {} }) {
  const html = path.join(__dirname, 'backup-picker.html');
  const expectedUrl = pathToFileURL(html).href;
  let active = null, lastDirectory = homeDirectory;
  ipcMain.handle(CHANNEL, async (event, request) => {
    const state = active;
    if (!state || !trustedPicker(event, state.window, expectedUrl)) return { ok: false, code: 'forbidden' };
    if (request?.action === 'cancel') { state.window.close(); return { ok: true }; }
    if (request?.action === 'init') return { ok: true, locale: state.locale, home: homeDirectory, directory: lastDirectory, filename: `AlKarna-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.conta.json` };
    if (request?.action === 'drives') return { ok: true, drives: await drives() };
    if (state.busy) return { ok: false, code: 'EBUSY' };
    state.busy = true;
    try {
      let result;
      if (request?.action === 'list') result = await deadline(listDirectory(request.directory, request.query));
      else if (request?.action === 'mkdir') {
        const directory = folderPath(request.directory), name = entryName(request.name);
        await deadline(fs.mkdir(path.join(directory, name), { mode: 0o700 }));
        result = { directory: path.join(directory, name) };
      } else if (request?.action === 'select') {
        result = await deadline(resolveDestination(request.directory, request.filename));
        if (active !== state || state.window.isDestroyed()) return { ok: false, code: 'canceled' };
        lastDirectory = path.dirname(result.filePath);
        state.selection = result;
        state.window.close();
      } else throw fail('invalid-action');
      return { ok: true, ...result };
    } catch (error) {
      log(`backup picker action=${request?.action} error=${error.code || 'unknown'}`);
      return { ok: false, code: error.code || 'folder-error' };
    } finally { state.busy = false; }
  });
  async function choose() {
    if (active) throw fail('backup-busy');
    // Reserve before the locale lookup to prevent concurrent windows.
    const state = { window: null, busy: false, selection: null, locale: 'ar' };
    active = state;
    try {
      state.locale = (await getLocale()) === 'fr' ? 'fr' : 'ar';
      const owner = getOwner();
      if (!owner || owner.isDestroyed()) throw fail('window-closed');
      state.window = new BrowserWindow({ parent: owner, modal: true, show: false, width: 860, height: 640, minWidth: 600, minHeight: 460,
        title: state.locale === 'fr' ? 'Enregistrer la sauvegarde' : 'حفظ النسخة الاحتياطية', autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'backup-picker-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, partition: 'backup-destination-picker' } });
      state.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      state.window.webContents.on('will-navigate', event => event.preventDefault());
      state.window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      return await new Promise((resolve, reject) => {
        state.window.once('closed', () => resolve(state.selection));
        state.window.once('ready-to-show', () => { if (!state.window.isDestroyed()) state.window.show(); });
        state.window.loadFile(html).catch(error => { reject(error); if (!state.window.isDestroyed()) state.window.destroy(); });
      });
    } finally { if (active === state) active = null; }
  }
  return { choose };
}
module.exports = { folderPath, entryName, backupName, deadline, listDirectory, resolveDestination, drives, trustedPicker, createBackupPicker };
