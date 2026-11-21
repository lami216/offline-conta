import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { captureControlLayouts } from './ui-control-bounds.mjs';

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'win32') {
  throw new Error('This restore UI check runs only in GitHub Actions on Windows.');
}
assert(process.execArgv.includes('--test') || process.env.NODE_TEST_CONTEXT !== undefined, 'Use the genuine Node test runner.');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(source, 'test-output', 'mobile-backup-ui');
const temporaryRoot = path.resolve(os.tmpdir());
const profile = fs.mkdtempSync(path.join(temporaryRoot, 'alkarna-mobile-restore-ui-'));
assert.equal(path.dirname(profile), temporaryRoot);
const insideProfile = value => {
  const target = path.resolve(value), relative = path.relative(profile, target);
  assert(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Private CI profile path');
  return target;
};
for (const directory of ['data', 'licensing', 'chrome', 'fixtures', 'exports']) fs.mkdirSync(insideProfile(path.join(profile, directory)));
fs.mkdirSync(output, { recursive: true });
Object.assign(process.env, {
  NODE_ENV: 'test', ALKARNA_DESKTOP: '1', ALKARNA_USER_DATA: profile,
  ALKARNA_DATABASE_PATH: insideProfile(path.join(profile, 'data', 'audit.sqlite')),
  ALKARNA_LICENSE_STATE_PATH: insideProfile(path.join(profile, 'licensing', 'state.json')),
  ALKARNA_LICENSE_DISABLE_REGISTRY: '1', ALKARNA_TEST_LICENSE_BYPASS: '1',
});
delete process.env.ALKARNA_DESKTOP_TOKEN;
delete process.env.ALKARNA_TEST_DEVICE_ID;
const result = { status: 'running', mode: 'Actual Settings upload, preview, confirmation, desktop login and native restore routes with a synthetic Mobile23 export', ciOnly: true, licenseBypass: 'test-only CI', screenshots: [], checkpoints: [], layouts: [], timeline: [] };
let database, closeDatabase, server, chrome, cdp, browserBundle;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, name, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(50); }
  throw new Error('Timed out waiting for ' + name);
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const sortRows = rows => copy(rows).sort((a, b) => String(a.id ?? a._id).localeCompare(String(b.id ?? b._id)));
async function connectCdp(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [], consoleMessages = [], network = [];
  let sequence = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled') consoleMessages.push({ type: message.params.type, args: message.params.args.map(argument => argument.value ?? argument.description) });
    if (message.method === 'Network.responseReceived') network.push({ url: message.params.response.url, status: message.params.response.status });
    if (message.method === 'Network.loadingFailed') network.push({ error: message.params.errorText });
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 25000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { call, errors, consoleMessages, network, close: () => socket.close(), async evaluate(expression) {
    const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  } };
}

async function main() {
  const { mobileBackupV23 } = await import('../tests/fixtures/mobile-backup-v23.mjs');
  const sourceFixture = mobileBackupV23();
  const actualExportPath = path.join(output, 'mobile23-export.conta.json');
  assert(fs.existsSync(actualExportPath), 'Run the exact Mobile23 exporter proof before this UI step');
  const fixtureText = fs.readFileSync(actualExportPath, 'utf8'), fixture = JSON.parse(fixtureText);
  assert.equal(fixture.format, 'alkarna-web-backup');
  assert.equal(fixture.schemaVersion, 1);
  assert.deepEqual(fixture.state.products, sourceFixture.state.products, 'Upload the real exporter output using the independently authored synthetic stock fixture');
  assert.deepEqual(fixture.state.records, sourceFixture.state.records, 'The exact Mobile23 exporter retains the synthetic source invoices');
  const fixturePath = insideProfile(path.join(profile, 'fixtures', 'mobile-v23.conta.json'));
  fs.writeFileSync(fixturePath, fixtureText);
  result.fixtureSha256 = sha256(fixtureText);
  const sqlite = await import('../lib/sqlite.ts');
  database = sqlite.initializeDatabase(); closeDatabase = sqlite.closeDatabase;
  const { hashPassword, CAPABILITIES } = await import('../lib/auth.ts');
  const desktopUsername = 'desktop-ci-owner', desktopPassword = 'private-ci-password-2046';
  await database.collection('users').insertOne({ id: 'owner', owner: true, username: desktopUsername, usernameNormalized: desktopUsername, name: 'مالك سطح المكتب التجريبي', passwordHash: hashPassword(desktopPassword), isActive: true, permissions: [...CAPABILITIES] });
  const desktopUsersBefore = sortRows(await database.collection('users').find().toArray());
  const { GET: bootstrapGET } = await import('../app/api/bootstrap/route.ts');
  const { POST: commandPOST } = await import('../app/api/command/route.ts');
  const { POST: loginPOST } = await import('../app/api/auth/login/route.ts');
  const { POST: previewPOST } = await import('../app/api/settings/restore/preview/route.ts');
  const { POST: restorePOST } = await import('../app/api/settings/restore/route.ts');
  const { GET: backupGET } = await import('../app/api/settings/backup/route.ts');
  const { GET: reportGET } = await import('../app/api/reports/route.ts');
  const { GET: historyGET } = await import('../app/api/history/route.ts');
  const { BACKUP_COLLECTIONS, parseAndValidateBackup } = await import('../lib/backup.ts');
  const financialCollections = ['products', 'parties', 'documents', 'stockMovements', 'financialMovements', 'paymentAccounts', 'accountTransfers'];
  const snapshot = async names => Object.fromEntries(await Promise.all(names.map(async name => [name, sortRows(await database.collection(name).find().toArray())])));
  const businessSnapshot = () => snapshot(financialCollections);
  const initialLicenseState = fs.existsSync(process.env.ALKARNA_LICENSE_STATE_PATH) ? fs.readFileSync(process.env.ALKARNA_LICENSE_STATE_PATH) : null;
  const entry = `
    import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{DataSettings,Records,Warehouses,Parties,Banks,Reports}from'./app/conta-app';
    import{LoginForm}from'./app/login/login-form';import{LocaleProvider,useI18n}from'./app/i18n/provider';
    import{ConfirmationProvider}from'./app/app-confirm';
    function Shell(){const[data,setData]=useState(null),[login,setLogin]=useState(false),[view,setView]=useState('settings');const{setLocale}=useI18n();
      const refresh=async()=>{const response=await fetch('/api/bootstrap');if(response.status===401){setData(null);setLogin(true);return}const value=await response.json();if(!response.ok)throw Error(value.error);setData(value);setLogin(false)};
      useEffect(()=>{void refresh().catch(error=>{window.__mobileError=error.stack;console.error(error)})},[]);
      useEffect(()=>{window.__mobileSetView=async next=>{await refresh();setView(next);document.getElementById('root').className='app-shell section-'+(next==='settings'?'settings':next==='records'?'records':next==='warehouses'?'warehouses':next==='banks'?'banks':next==='sales-report'?'reports':next)};window.__mobileSetLocale=setLocale;return()=>{delete window.__mobileSetView;delete window.__mobileSetLocale}},[setLocale]);
      if(login)return <main className='login'><div className='login-card'><h1>تسجيل الدخول</h1><LoginForm exitButton={null}/></div></main>;
      if(!data)return <p>Loading</p>;
      if(view==='records')return <Records data={data} openDoc={id=>{window.__mobileOpenedDocument=id}}/>;
      if(view==='warehouses')return <Warehouses data={data} run={()=>{throw Error('Unexpected inventory mutation')}} openDoc={id=>{window.__mobileOpenedDocument=id}}/>;
      if(view==='customers'||view==='suppliers')return <Parties key={view} partyType={view==='customers'?'customer':'supplier'} data={data} run={()=>{throw Error('Unexpected party mutation')}} openParty={party=>{window.__mobileOpenedParty=party.id}} canEdit={false} canDelete={false} registerEditorGuard={()=>()=>{}} prepareEditorReplacement={async()=>true}/>;
      if(view==='banks')return <Banks data={data} run={()=>{throw Error('Unexpected account mutation')}} openDoc={id=>{window.__mobileOpenedDocument=id}} openSource={()=>{}} tab='accounts' sourceRequest={null} clearSourceRequest={()=>{}} registerEditorGuard={()=>()=>{}} prepareEditorReplacement={async()=>true}/>;
      if(view==='sales-report')return <Reports data={data} openDoc={id=>{window.__mobileOpenedDocument=id}} openSource={()=>{}} type='sales' sourceRequest={null} clearSourceRequest={()=>{}}/>;
      return <section className='settings-page'><DataSettings data={data} reload={refresh}/></section>;
    }
    window.alkarnaBackup={save:async()=>{const response=await fetch('/__ci/native-backup-save',{method:'POST'});const value=await response.json();if(!response.ok)throw Error(value.error);return value}};
    createRoot(document.getElementById('root')).render(<LocaleProvider initialLocale='ar'><ConfirmationProvider><Shell/></ConfirmationProvider></LocaleProvider>);
  `;
  const bundle = await build({ absWorkingDir: source, stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
    plugins: [{ name: 'ci-only-existing-components', setup(builder) {
      builder.onLoad({ filter: /[\\/]app[\\/]conta-app\.tsx$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8') + '\nexport {DataSettings,Records,Warehouses,Parties,Banks,Reports};\n', loader: 'tsx', resolveDir: path.dirname(args.path) }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'router', namespace: 'ci-navigation' }));
      builder.onLoad({ filter: /.*/, namespace: 'ci-navigation' }, () => ({ contents: "export function useRouter(){return{replace:href=>window.location.assign(href),refresh:()=>{}}}", loader: 'js' }));
    } }], define: { 'process.env.NODE_ENV': JSON.stringify('production') } });
  browserBundle = bundle.outputFiles[0].contents;
  const styles = [...fs.readFileSync(path.join(source, 'app', 'layout.tsx'), 'utf8').matchAll(/^import "\.\/([^"\r\n]+\.css)";/gm)].map(match => match[1]);
  assert(styles.includes('globals.css'), 'Use the application theme');
  const css = styles.map(name => fs.readFileSync(path.join(source, 'app', name), 'utf8')).join('\n').replace(/^[ \t]*@import[^\r\n]*;[ \t]*(?:\r?\n|$)/gm, '');
  let backupNumber = 0;
  server = http.createServer(async (request, response) => {
    try {
      const origin = 'http://' + request.headers.host, url = new URL(request.url, origin);
      if (url.pathname === '/app.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(browserBundle); return; }
      if (url.pathname === '/app.css') { response.writeHead(200, { 'content-type': 'text/css' }); response.end(css); return; }
      if (url.pathname === '/' || url.pathname === '/login') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>body{display:block;margin:0}#root{display:block;min-height:100vh;padding:12px;box-sizing:border-box}</style><div id="root" class="app-shell section-settings"></div><script src="/app.js"></script></html>'); return; }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]));
      const webRequest = new Request(url, { method: request.method, headers, ...(request.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      let value;
      if (url.pathname === '/__ci/native-backup-save') {
        value = await backupGET(new Request(origin + '/api/settings/backup', { headers }));
        if (value.ok) {
          const bytes = Buffer.from(await value.arrayBuffer()), text = bytes.toString('utf8');
          parseAndValidateBackup(text);
          const file = insideProfile(path.join(profile, 'exports', 'native-' + (++backupNumber) + '.conta.json'));
          fs.writeFileSync(file, bytes);
          result.timeline.push({ type: 'native-backup-saved', index: backupNumber, sha256: sha256(bytes), bytes: bytes.length });
          value = Response.json({ ok: true, filePath: file });
        }
      } else if (url.pathname === '/api/bootstrap') value = await bootstrapGET(webRequest);
      else if (url.pathname === '/api/auth/login') value = await loginPOST(webRequest);
      else if (url.pathname === '/api/settings/restore/preview') {
        value = await previewPOST(webRequest);
        if (value.ok) { const preview = await value.clone().json(); (result.previews ??= []).push({ format: preview.format, schemaVersion: preview.schemaVersion, counts: preview.counts }); }
      }
      else if (url.pathname === '/api/settings/restore') {
        result.timeline.push({ type: 'restore-start', safetyBackups: backupNumber });
        value = await restorePOST(webRequest);
        result.timeline.push({ type: 'restore-result', status: value.status, sessionReset: /Max-Age=0/.test(value.headers.get('set-cookie') ?? '') });
      } else if (url.pathname === '/api/settings/backup') value = await backupGET(webRequest);
      else if (url.pathname === '/api/command') value = await commandPOST(webRequest);
      else if (url.pathname === '/api/reports') value = await reportGET(webRequest);
      else if (url.pathname === '/api/history') value = await historyGET(webRequest);
      else value = new Response('Not found', { status: 404 });
      response.writeHead(value.status, Object.fromEntries(value.headers)); response.end(Buffer.from(await value.arrayBuffer()));
    } catch (error) { response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const executable = [process.env.CHROME_PATH, path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe')].find(file => file && fs.existsSync(file));
  assert(executable, 'Chrome exists on the Windows runner');
  chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + insideProfile(path.join(profile, 'chrome')), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = insideProfile(path.join(profile, 'chrome', 'DevToolsActivePort'));
  await until(() => fs.existsSync(portFile), 'Chrome debugging port');
  const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0], targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  cdp = await connectCdp(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable', 'DOM.enable']) await cdp.call(method);
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const evaluate = expression => cdp.evaluate(expression);
  const click = selector => evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button||button.disabled)throw Error('Unavailable '+${JSON.stringify(selector)});button.click()})()`);
  const fill = (selector, value) => evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing field');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(String(value))});element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const browserRequest = async (pathname, init = {}) => evaluate(`(async()=>{const response=await fetch(${JSON.stringify(pathname)},${JSON.stringify(init)});return{status:response.status,text:await response.text()}})()`);
  const jsonRequest = async (pathname, init) => { const response = await browserRequest(pathname, init); let body; try { body = JSON.parse(response.text); } catch { throw Error('Invalid API JSON ' + response.text.slice(0, 300)); } assert.equal(response.status, 200, JSON.stringify(body)); return body; };
  const command = async body => (await jsonRequest('/api/command', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) })).id;
  async function screenshot(name, width = 1280) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'), false, name + ' page overflow');
    const capture = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(capture.data, 'base64')); result.screenshots.push(name + '.png');
  }
  async function login() {
    await until(() => evaluate('Boolean(document.querySelector(".login input[name=username]"))'), 'the actual login form');
    await fill('.login input[name=username]', desktopUsername); await fill('.login input[name=password]', desktopPassword); await click('.login-submit');
    await until(() => evaluate('Boolean(document.querySelector(".settings-import input[type=file]"))'), 'desktop credentials accepted');
  }
  async function upload(file) {
    await evaluate('window.__mobileSetView("settings")');
    await until(() => evaluate('Boolean(document.querySelector(".settings-import input[type=file]"))'), 'actual Settings upload');
    const document = await cdp.call('DOM.getDocument', {}), node = await cdp.call('DOM.querySelector', { nodeId: document.root.nodeId, selector: '.settings-import input[type=file]' });
    assert(node.nodeId, 'The actual file input is mounted');
    await cdp.call('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [file] });
    await until(() => evaluate('Boolean(document.querySelector(".source-preview .danger")) || Boolean(document.querySelector(".settings-feedback .error"))'), 'native restore preview');
    assert.equal(await evaluate('document.querySelector(".settings-feedback .error")?.textContent ?? ""'), '', 'Mobile export is accepted by the actual preview route');
  }
  async function restoreFromPreview(accept) {
    await click('.source-preview .danger');
    await until(() => evaluate('Boolean(document.querySelector(".app-confirm-dialog"))'), 'destructive restore confirmation');
    if (!accept) { await click('.app-confirm-actions button:last-child'); await until(() => evaluate('!document.querySelector(".app-confirm-dialog")'), 'canceled restore'); return; }
    const restoreCount = result.timeline.filter(event => event.type === 'restore-result').length;
    await click('.app-confirm-actions button:first-child');
    await until(() => result.timeline.filter(event => event.type === 'restore-result').length === restoreCount + 1, 'committed full restore');
    assert.equal(result.timeline.at(-1).status, 200, 'Real restore route succeeds');
    assert.equal(result.timeline.at(-1).sessionReset, true, 'Restore expires the old browser session');
    await login();
  }

  await cdp.call('Page.navigate', { url: origin }); await login();
  const initialBootstrap = await jsonRequest('/api/bootstrap'), originalWarehouse = initialBootstrap.warehouses.find(row => row.isSalesDefault && !row.isArchived);
  assert(originalWarehouse, 'Fresh private profile has a sales warehouse');
  const originalProductId = await command({ type: 'product.create', name: 'منتج سطح المكتب قبل الاستعادة', pieceCost: 3, piecePrice: 5, openingStock: 2, openingWarehouseId: originalWarehouse.id });
  const originalBefore = await snapshot(BACKUP_COLLECTIONS), originalBusiness = await businessSnapshot();
  const sessionSecret = fs.readFileSync(insideProfile(path.join(profile, 'config', 'session-secret')));
  await evaluate('sessionStorage.setItem("conta:restore-ui-draft","must-clear")');
  await upload(fixturePath);
  assert.equal(result.previews.at(-1).counts.products, 2);
  assert.equal(result.previews.at(-1).counts.parties, 2);
  assert.equal(await evaluate('[...document.querySelectorAll(".preview-count-grid>span")].some(row=>row.firstChild?.textContent.trim()==="products" && row.querySelector("b")?.textContent.trim()==="2")'), true, 'Actual preview shows the normalized product count');
  assert.deepEqual(await snapshot(BACKUP_COLLECTIONS), originalBefore, 'Preview performs no database or financial writes');
  await screenshot('mobile-restore-preview-ar-1280');
  result.layouts.push(...await captureControlLayouts({ cdp, screenshot, scope: '.settings-import', name: 'mobile-restore-preview-ar', widths: [1280, 480] }));
  await restoreFromPreview(false);
  assert.deepEqual(await snapshot(BACKUP_COLLECTIONS), originalBefore, 'Cancel leaves every original backup collection intact');
  assert.deepEqual(await businessSnapshot(), originalBusiness, 'Cancel leaves all original records and balances intact');
  assert.equal(result.timeline.length, 0, 'Cancel does not export or submit a restore');
  result.checkpoints.push('Actual Settings file upload previews Mobile23 without writes; canceling its destructive confirmation preserves the desktop database exactly');
  await restoreFromPreview(true);
  assert.equal(await evaluate('sessionStorage.getItem("conta:restore-ui-draft")'), null, 'Actual restore clears stale desktop drafts');
  assert.deepEqual(sortRows(await database.collection('users').find().toArray()), desktopUsersBefore, 'Mobile credentials never replace desktop users');
  assert.deepEqual(fs.readFileSync(insideProfile(path.join(profile, 'config', 'session-secret'))), sessionSecret, 'Restore preserves the desktop signing secret');
  assert.deepEqual(fs.existsSync(process.env.ALKARNA_LICENSE_STATE_PATH) ? fs.readFileSync(process.env.ALKARNA_LICENSE_STATE_PATH) : null, initialLicenseState, 'Restore does not create or change activation state');
  assert.equal(await database.collection('products').findOne({ id: originalProductId }), null, 'Full restore replaces the old business data');
  const firstSafety = JSON.parse(fs.readFileSync(insideProfile(path.join(profile, 'exports', 'native-1.conta.json')), 'utf8'));
  assert(firstSafety.collections.products.some(product => product.id === originalProductId), 'The actual safety export contains the pre-restore desktop product');
  assert.deepEqual(sortRows(firstSafety.collections.users), desktopUsersBefore, 'Safety export retains the original desktop users');
  fs.copyFileSync(insideProfile(path.join(profile, 'exports', 'native-1.conta.json')), path.join(output, 'safety-before-mobile.conta.json'));
  for (let index = 0; index < result.timeline.length; index++) if (result.timeline[index].type === 'restore-start') assert.equal(result.timeline[index - 1]?.type, 'native-backup-saved', 'Verified safety save completes before replacement');
  result.checkpoints.push('Confirmed restore first saves a validated native safety file, expires the session, clears stale drafts and accepts the same desktop credentials while preserving users and activation');

  const restored = await jsonRequest('/api/bootstrap'), restoredBusiness = await businessSnapshot();
  for (const sourceProduct of sourceFixture.state.products) {
    const actual = await database.collection('products').findOne({ id: 'mobile23:product:' + sourceProduct.id }); assert(actual, 'Restored mobile product identity');
    assert.equal(actual.name, sourceProduct.name);
    for (const [warehouseName, quantity] of Object.entries(sourceProduct.stocks)) {
      const warehouse = restored.warehouses.find(row => row.name === warehouseName); assert(warehouse, 'Original named warehouse is present');
      assert.equal(actual.stocks[warehouse.id] ?? 0, quantity, 'Warehouse stock quantities are not summed or recreated');
    }
  }
  for (const sourceParty of sourceFixture.state.parties) {
    const actual = await database.collection('parties').findOne({ id: 'mobile23:party:' + sourceParty.id }); assert(actual, 'Restored mobile party identity');
    const signed = sourceParty.type === 'supplier' ? -sourceParty.balance : sourceParty.balance;
    assert.equal(actual.name, sourceParty.name); assert.equal(actual.receivable, Math.max(0, signed)); assert.equal(actual.payable, Math.max(0, -signed));
  }
  for (const sourceAccount of sourceFixture.state.accounts) {
    const actual = await database.collection('paymentAccounts').findOne({ id: 'mobile23:account:' + sourceAccount.id }); assert(actual, 'Restored mobile account identity');
    assert.equal(actual.balance, sourceAccount.balance, 'Restored cash balance');
  }
  for (const sourceDocument of sourceFixture.state.records) {
    const actual = await database.collection('documents').findOne({ id: 'mobile23:record:' + sourceDocument.id }); assert(actual, 'Restored mobile invoice identity');
    assert.equal(actual.status, sourceDocument.voided ? 'voided' : 'posted');
    if (['sale', 'purchase', 'expense'].includes(sourceDocument.kind)) assert.equal(actual.total, sourceDocument.total, 'Original commerce amount is preserved');
    if (sourceDocument.note) assert.equal(actual.note, sourceDocument.note, 'Original literal note is preserved');
    if (['sale', 'purchase'].includes(sourceDocument.kind)) {
      assert.equal(actual.lines.length, sourceDocument.lines.length);
      for (const [index, sourceLine] of sourceDocument.lines.entries()) {
        assert.equal(actual.lines[index].productId, 'mobile23:product:' + sourceLine.product);
        assert.equal(actual.lines[index].quantity, sourceLine.qty);
        assert.equal(actual.lines[index].unitPrice, sourceLine.price);
        if (sourceDocument.kind === 'sale' && sourceLine.costAtSale !== undefined) assert.equal(actual.lines[index].costAtSale, sourceLine.costAtSale, 'Saved sale cost is not repriced');
      }
    }
  }
  assert.equal(restored.products.length, 2);
  const salesBefore = await jsonRequest('/api/reports?type=sales&allTime=true&unpaged=true');
  const purchasesBefore = await jsonRequest('/api/reports?type=purchases&allTime=true&unpaged=true');
  const overviewBefore = await jsonRequest('/api/reports?type=overview&allTime=true&unpaged=true');
  assert.equal(salesBefore.summary.netSales, 72); assert.equal(salesBefore.summary.cost, 35); assert.equal(salesBefore.summary.profit, 37);
  assert.equal(purchasesBefore.summary.total, 60); assert.equal(overviewBefore.summary.expenses, 20); assert.equal(overviewBefore.summary.netOperatingResult, 17);
  assert.equal(overviewBefore.summary.currentAccountsBalance, 1197); assert.equal(overviewBefore.summary.currentInventoryValue, 160);
  result.restoredSummary = { products: restored.products.length, parties: restored.parties.length, accounts: restored.paymentAccounts.length, sales: salesBefore.summary, purchases: purchasesBefore.summary };
  await evaluate('window.__mobileSetView("records")');
  await until(() => evaluate('Boolean(document.querySelector(".records-workspace .compact-date-range button"))'), 'real invoice history');
  await click('.records-workspace .compact-date-range button');
  const sourceSaleNumber = String(sourceFixture.state.records.find(row => row.id === 117).number);
  await until(() => evaluate(`[...document.querySelectorAll('.records-workspace .recent-table tbody tr')].some(row=>row.children[2]?.textContent.trim()===${JSON.stringify(sourceSaleNumber)})`), 'restored mobile invoice history rows');
  await evaluate(`(()=>{const row=[...document.querySelectorAll('.records-workspace .recent-table tbody tr')].find(row=>row.children[2]?.textContent.trim()===${JSON.stringify(sourceSaleNumber)});row.click()})()`);
  assert.equal(await evaluate('window.__mobileOpenedDocument'), 'mobile23:record:117', 'Actual history opens the original mobile invoice identity');
  await screenshot('mobile-restored-invoices-ar-1280');
  await evaluate('window.__mobileSetView("warehouses")');
  await until(() => evaluate('Boolean(document.querySelector(".warehouse-workspace"))'), 'real restored inventory');
  await click('.warehouse-workspace .compact-date-range button:last-child');
  for (const sourceProduct of sourceFixture.state.products) await until(() => evaluate(`document.querySelector('.warehouse-workspace')?.textContent.includes(${JSON.stringify(sourceProduct.name)})`), 'visible restored stock product ' + sourceProduct.id);
  await screenshot('mobile-restored-inventory-ar-1280');
  await evaluate('window.__mobileSetView("customers")'); await until(() => evaluate('Boolean(document.querySelector(".parties-workspace"))'), 'real restored customer list');
  assert.equal(await evaluate(`document.querySelector('.parties-workspace')?.textContent.includes(${JSON.stringify(sourceFixture.state.parties.find(party => party.type === 'customer').name)})`), true);
  await screenshot('mobile-restored-parties-ar-1280');
  await evaluate('window.__mobileSetView("suppliers")'); await until(() => evaluate(`document.querySelector('.parties-workspace')?.textContent.includes(${JSON.stringify(sourceFixture.state.parties.find(party => party.type === 'supplier').name)})`), 'real restored supplier list');
  await screenshot('mobile-restored-supplier-ar-1280');
  await evaluate('window.__mobileSetView("banks")'); await until(() => evaluate('Boolean(document.querySelector(".bank-tab-accounts"))'), 'real restored account list');
  for (const sourceAccount of sourceFixture.state.accounts) assert.equal(await evaluate(`document.querySelector('.bank-tab-accounts')?.textContent.includes(${JSON.stringify(sourceAccount.name)})`), true, 'Actual account list preserves the mobile account name');
  for (const amount of ['982', '215']) assert.equal(await evaluate(`document.querySelector('.bank-tab-accounts')?.textContent.includes(${JSON.stringify(amount)})`), true, 'Actual cash table shows the restored balance');
  await screenshot('mobile-restored-cash-ar-1280');
  await evaluate('window.__mobileSetView("sales-report")'); await until(() => evaluate('Boolean(document.querySelector(".reports-workspace"))'), 'real restored sales report');
  await click('.reports-workspace .compact-date-range button:last-child');
  await until(() => evaluate('["72","35","37"].every(amount=>document.querySelector(".report-kpis")?.textContent.includes(amount))'), 'all-time restored sales, cost and profit');
  await screenshot('mobile-restored-report-ar-1280');
  assert.deepEqual(await businessSnapshot(), restoredBusiness, 'Viewing invoices, stock, parties and reports does not change imported commerce');
  result.checkpoints.push('Restored mobile invoice snapshots, per-warehouse stock, party balances and cash match the source, and the actual history, inventory and report components show the restored data without mutation');

  await evaluate('window.__mobileSetView("settings")'); await until(() => evaluate('Boolean(document.querySelector(".settings-backup button"))'), 'native re-export action');
  const exportsBefore = backupNumber; await click('.settings-backup button'); await until(() => backupNumber === exportsBefore + 1, 'actual Settings re-export');
  const nativePath = insideProfile(path.join(profile, 'exports', 'native-' + backupNumber + '.conta.json'));
  const nativeBackup = parseAndValidateBackup(fs.readFileSync(nativePath, 'utf8'));
  fs.copyFileSync(nativePath, path.join(output, 'desktop-reexport.conta.json'));
  result.nativeReexport = { sha256: sha256(fs.readFileSync(nativePath)), bytes: fs.statSync(nativePath).size, format: nativeBackup.format, appVersion: nativeBackup.appVersion, counts: nativeBackup.counts };
  assert.deepEqual(sortRows(nativeBackup.collections.users), desktopUsersBefore);
  assert.deepEqual(await businessSnapshot(), restoredBusiness, 'Native re-export does not change business data');
  await evaluate('window.__mobileSetLocale("fr")');
  await until(() => evaluate('document.documentElement.lang==="fr"'), 'French Settings locale');
  await upload(nativePath);
  result.layouts.push(...await captureControlLayouts({ cdp, screenshot, scope: '.settings-import', name: 'mobile-native-reexport-preview-fr', widths: [1280, 480] }));
  await restoreFromPreview(true);
  assert.deepEqual(await businessSnapshot(), restoredBusiness, 'Canonical native re-export restores a second time without duplicate stock, cash or invoices');
  const afterRoundtripSales = await jsonRequest('/api/reports?type=sales&allTime=true&unpaged=true');
  assert.deepEqual(afterRoundtripSales.summary, salesBefore.summary, 'Sales accounting survives mobile-to-native round trip');
  assert.deepEqual((await jsonRequest('/api/reports?type=purchases&allTime=true&unpaged=true')).summary, purchasesBefore.summary);
  result.checkpoints.push('Actual Settings re-export creates a validated native backup; uploading and confirming that file again preserves invoices, stocks, debts, cash and report totals exactly');

  const bootstrap = await jsonRequest('/api/bootstrap'), warehouse = bootstrap.warehouses.find(row => row.isSalesDefault && !row.isArchived), account = bootstrap.paymentAccounts.find(row => row.id === 'mobile23:account:1');
  assert(warehouse && account);
  const product = bootstrap.products.find(row => !row.isArchived && Number(row.stocks?.[warehouse.id]) >= 1 && Number(row.lastPurchaseCost) > 0);
  assert(product, 'The mobile fixture includes a sellable product with a proven positive purchase cost');
  const beforeSale = await businessSnapshot(), price = Number(product.piecePrice) > 0 ? Number(product.piecePrice) : Number(product.lastPurchaseCost) + 25;
  const id = await command({ type: 'sale.post', warehouseId: warehouse.id, paymentMethod: account.id, lines: [{ productId: product.id, quantity: 1, piecePrice: price }] });
  const savedSale = await database.collection('documents').findOne({ id });
  assert.equal(savedSale.lines[0].costAtSale, product.lastPurchaseCost, 'A fresh sale uses restored accounting cost');
  assert.equal((await database.collection('products').findOne({ id: product.id })).stocks[warehouse.id], Number(product.stocks[warehouse.id]) - 1);
  assert.equal((await database.collection('paymentAccounts').findOne({ id: account.id })).balance, Number(account.balance) + savedSale.total);
  await command({ type: 'sale.void', documentId: id, expectedRevision: savedSale.revision ?? 0, reason: 'إلغاء بيع اختبار الاستعادة' });
  const afterVoid = await businessSnapshot();
  const financialFields = {
    products: ['id', 'stocks', 'pieceCost', 'piecePrice', 'wholesalePrice', 'openingStock', 'openingCost', 'openingWarehouseId', 'legacyOpeningCost', 'categoryId', 'isArchived'],
    parties: ['id', 'partyType', 'receivable', 'payable', 'net', 'isArchived'],
    paymentAccounts: ['id', 'code', 'balance', 'openingBalance', 'isActive', 'isArchived'],
  };
  for (const [name, keys] of Object.entries(financialFields)) {
    const project = rows => rows.map(row => Object.fromEntries(keys.map(key => [key, row[key]])));
    assert.deepEqual(project(afterVoid[name]), project(beforeSale[name]), 'Sale and void return every financial field in ' + name + ' exactly');
  }
  assert.deepEqual(afterVoid.accountTransfers, beforeSale.accountTransfers);
  for (const row of beforeSale.documents) assert.deepEqual(afterVoid.documents.find(item => item.id === row.id), row, 'Original imported invoices remain unchanged after new operations');
  assert.equal((await database.collection('documents').findOne({ id })).status, 'voided');
  assert.deepEqual((await jsonRequest('/api/reports?type=sales&allTime=true&unpaged=true')).summary, salesBefore.summary);
  assert.deepEqual(sortRows(await database.collection('users').find().toArray()), desktopUsersBefore);
  for (let index = 0; index < result.timeline.length; index++) if (result.timeline[index].type === 'restore-start') assert.equal(result.timeline[index - 1]?.type, 'native-backup-saved', 'Every full restore has a completed safety save');
  assert.equal(sha256(fs.readFileSync(fixturePath)), result.fixtureSha256, 'Original synthetic mobile file is untouched');
  assert.deepEqual(cdp.errors, []);
  result.invariants = { previewNoMutation: true, canceledRestoreNoMutation: true, safetyFileBeforeEveryRestore: true, desktopUsersPreserved: true, desktopCredentialsReauthenticated: true, licenseStateUnchanged: true, originalMobileFileUnchanged: true, mobileStockCashDebtAndSavedCostPreserved: true, nativeRoundTripReportsUnchanged: true, newSaleVoidRestoresFinancialBalances: true };
  result.checkpoints.push('A real sale after restoration saves the restored purchase cost, updates cash and stock once, and its real void restores balances while retaining all original mobile invoices and report totals');
  result.status = 'passed';
}

try { await main(); }
catch (error) {
  result.status = 'failed'; result.error = error.stack;
  result.browserErrors = cdp?.errors ?? []; result.browserConsole = cdp?.consoleMessages ?? []; result.browserNetwork = cdp?.network ?? [];
  if (browserBundle) fs.writeFileSync(path.join(output, 'bundle.js'), browserBundle);
  if (cdp) try {
    const capture = await cdp.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(capture.data, 'base64'));
    fs.writeFileSync(path.join(output, 'failure.html'), await cdp.evaluate('document.documentElement.outerHTML'));
  } catch { /* Preserve the original diagnostic if Chrome has already closed. */ }
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (chrome && chrome.exitCode === null) spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  closeDatabase?.();
  const resolved = path.resolve(profile); assert.equal(path.dirname(resolved), temporaryRoot); assert(path.basename(resolved).startsWith('alkarna-mobile-restore-ui-'));
  try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); result.profileRemoved = true; }
  catch (error) { result.profileRemoved = false; result.cleanupError = error.message; process.exitCode = 1; }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result));
