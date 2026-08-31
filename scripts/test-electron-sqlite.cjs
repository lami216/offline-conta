/* eslint-disable @typescript-eslint/no-require-imports -- Electron's Node-mode smoke test and the staged CommonJS addon require CJS loading. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(1);
});

const repositoryRoot = path.resolve(__dirname, '..');
const stagedApp = path.join(repositoryRoot, 'desktop-dist', 'app');
const requiredPaths = [
  'server.js',
  '.next/static',
  'public/alkarna-logo.png',
  'node_modules/better-sqlite3',
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/sql.js/dist/sql-wasm.wasm',
];

for (const relativePath of requiredPaths) {
  const stagedPath = path.join(stagedApp, relativePath);
  assert.ok(fs.existsSync(stagedPath), `Missing staged desktop resource: ${stagedPath}`);
}

if (!process.env.ALKARNA_ELECTRON_SQLITE_CHILD) {
  const electron = require('electron');
  const result = spawnSync(electron, [__filename], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ALKARNA_ELECTRON_SQLITE_CHILD: '1',
    },
  });

  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const Database = require(path.join(stagedApp, 'node_modules', 'better-sqlite3'));
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'alkarna-electron-sqlite-'));
const databasePath = path.join(temporaryDirectory, 'smoke.sqlite');
let database;

try {
  database = new Database(databasePath);
  database.exec('CREATE TABLE smoke_test (value TEXT NOT NULL)');
  database.prepare('INSERT INTO smoke_test (value) VALUES (?)').run('electron-abi-ok');
  const row = database.prepare('SELECT value FROM smoke_test').get();
  assert.equal(row.value, 'electron-abi-ok');
  console.log(`Electron ${process.versions.electron} better-sqlite3 smoke test passed.`);
} finally {
  database?.close();
  fs.rmSync(temporaryDirectory, {recursive: true, force: true});
}
