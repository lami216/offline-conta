import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, readFile, readdir, realpath, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, extname, join, resolve, sep} from 'node:path';
import {createRequire} from 'node:module';
import net from 'node:net';
import process from 'node:process';

const require = createRequire(import.meta.url);
const repositoryRoot = await realpath(process.cwd());
const packaged = process.argv.includes('--packaged');

async function packagedRuntime() {
  const dist = join(repositoryRoot, 'dist');
  const trees = (await readdir(dist, {withFileTypes: true})).filter((item) => item.isDirectory() && item.name.endsWith('unpacked'));
  if (trees.length !== 1) throw new Error(`Expected one electron-builder unpacked tree, found: ${trees.map((x) => x.name).join(', ') || 'none'}`);
  const tree = join(dist, trees[0].name);
  const executable = (await readdir(tree)).find((file) => file.toLowerCase().endsWith('.exe'));
  if (!executable) throw new Error(`Packaged Electron executable missing from ${tree}`);
  return {root: join(tree, 'resources', 'app'), electronExecutable: join(tree, executable)};
}

const runtime = packaged
  ? await packagedRuntime()
  : {root: process.argv[2] ?? join(repositoryRoot, 'desktop-dist', 'app'), electronExecutable: require('electron')};
const root = await realpath(runtime.root);
const entry = join(root, 'server.js');
const inside = (candidate) => candidate === root || candidate.startsWith(`${root}${sep}`);
const runtimeRequire = createRequire(entry);
for (const specifier of ['better-sqlite3', 'better-sqlite3/build/Release/better_sqlite3.node']) {
  const resolved = await realpath(runtimeRequire.resolve(specifier));
  if (!inside(resolved)) throw new Error(`${packaged ? 'Packaged' : 'Staged'} resolution escaped runtime: ${specifier} -> ${resolved}`);
}

// Runtime JS/JSON must not retain a dependency on the checkout or the staged
// tree. Text assets are deliberately bounded so native binaries are not read.
const forbidden = new Set([repositoryRoot, repositoryRoot.replaceAll('\\', '/'), resolve(repositoryRoot)]);
if (packaged) forbidden.add(await realpath(join(repositoryRoot, 'desktop-dist', 'app')));
async function auditText(directory) {
  for (const item of await readdir(directory, {withFileTypes: true})) {
    const file = join(directory, item.name);
    if (item.isDirectory()) await auditText(file);
    else if (item.isFile() && ['.js', '.cjs', '.mjs', '.json'].includes(extname(item.name)) && (await stat(file)).size < 20_000_000) {
      const content = await readFile(file, 'utf8');
      for (const value of forbidden) if (value && content.includes(value)) throw new Error(`Build-machine path remains in runtime text: ${file} contains ${value}`);
    }
  }
}
await auditText(root);

const probe = spawnSync(runtime.electronExecutable, [join(repositoryRoot, 'scripts', 'electron-runtime-probe.cjs'), root, packaged ? 'PACKAGED' : 'STAGED'], {
  cwd: root,
  stdio: 'inherit',
  env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
});
if (probe.error) throw probe.error;
if (probe.status !== 0) throw new Error(`${packaged ? 'Packaged' : 'Staged'} Electron native probe failed with ${probe.status}`);

const directory = await mkdtemp(join(tmpdir(), 'alkarna-packaged-server-'));
const port = await new Promise((resolvePort, reject) => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolvePort(value)); }); server.on('error', reject); });
const origin = `http://127.0.0.1:${port}`;
const env = {...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', ALKARNA_DESKTOP: '1', ALKARNA_USER_DATA: directory, ALKARNA_DATABASE_PATH: join(directory, 'data', 'alkarna.sqlite'), HOSTNAME: '127.0.0.1', PORT: String(port)};
let child;
const start = () => { console.log(`Starting ${basename(runtime.electronExecutable)} with ${entry}`); child = spawn(runtime.electronExecutable, [entry], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']}); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); };
const stop = () => new Promise((done) => { if (!child || child.exitCode !== null) return done(); child.once('exit', done); child.kill(); });
const wait = async () => {
  let repeatedFatal = null;
  let repeatedCount = 0;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`packaged server exited ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
      const body = await response.text();
      if (response.status === 500) {
        if (body === repeatedFatal) repeatedCount++; else { repeatedFatal = body; repeatedCount = 1; }
        if (repeatedCount === 1) console.error(`Fatal health response (HTTP 500):\n${body}`);
        if (repeatedCount >= 3) throw new Error(`Health returned the same fatal HTTP 500 response ${repeatedCount} times`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Health returned')) throw error;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('packaged server health timeout');
};
const login = async () => { const response = await fetch(`${origin}/api/auth/login`, {method: 'POST', redirect: 'manual', headers: {Origin: origin, Host: `127.0.0.1:${port}`}, body: new URLSearchParams({username: 'المالك', password: '12345678'})}); if (response.status !== 303) throw new Error(`login status ${response.status}`); const cookie = response.headers.get('set-cookie')?.split(';')[0]; if (!cookie) throw new Error('login cookie missing'); return cookie; };

try {
  start(); await wait();
  let cookie = await login();
  let bootstrap = await fetch(`${origin}/api/bootstrap`, {headers: {cookie}}).then((response) => response.json());
  if (!bootstrap.warehouses?.length || !bootstrap.paymentAccounts?.length) throw new Error('defaults missing');
  const response = await fetch(`${origin}/api/command`, {method: 'POST', headers: {cookie, Origin: origin, Host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'Idempotency-Key': 'desktop-smoke-product'}, body: JSON.stringify({type: 'product.create', name: 'Desktop smoke product'})});
  if (!response.ok) throw new Error(`mutation failed ${response.status}: ${await response.text()}`);
  await stop(); start(); await wait(); cookie = await login();
  bootstrap = await fetch(`${origin}/api/bootstrap`, {headers: {cookie}}).then((response) => response.json());
  if (!bootstrap.products?.some((product) => product.name === 'Desktop smoke product')) throw new Error('restart persistence failed');
  console.log(`${packaged ? 'packaged' : 'staged'} desktop server smoke passed`);
} finally { await stop(); await rm(directory, {recursive: true, force: true}); }
