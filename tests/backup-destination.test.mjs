import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { folderPath, backupName, listDirectory, resolveDestination, deadline, trustedPicker } = require('../desktop/backup-picker.cjs');
const { createBackupStore, registerBackupHandlers } = require('../desktop/backup-store.cjs');
const fs = require('node:fs/promises');
const json = text => new Response(text, { headers: { 'content-type': 'application/json' } });
async function fixture(t) {const home = await mkdtemp(join(tmpdir(), 'backup-choice-'));t.after(() => rm(home, { recursive: true, force: true }));const usb = join(home, 'USB');await mkdir(usb);return { home, usb };}

test('accepts local drive and USB folders; rejects devices, UNC, streams and relative paths', () => {
  assert.equal(folderPath('E:\\نسخ\\اليوم', 'win32'), 'E:\\نسخ\\اليوم');
  assert.equal(folderPath('C:/Users/Test', 'win32'), 'C:\\Users\\Test');
  for(const value of ['E:copy', '\\\\?\\C:\\x', '\\\\server\\share', 'C:\\a:secret', '../x', '', 'C:\\a\u0000']) assert.throws(() => folderPath(value, 'win32'));
});
test('backup filenames retain the portable extension and reject traversal or devices', () => {
  assert.equal(backupName('نسخة اليوم'), 'نسخة اليوم.conta.json');
  assert.equal(backupName('today.json'), 'today.conta.json');
  assert.equal(backupName('today.conta.json'), 'today.conta.json');
  for(const value of ['../x', 'a/b', 'C:\\x', 'CON', 'NUL.json', 'x:secret', 'x.', '']) assert.throws(() => backupName(value));
});
test('browse shows real folders and existing backups without parsing files or shell metadata', async t => {
  const { usb } = await fixture(t);await mkdir(join(usb, 'فرع'));await writeFile(join(usb, 'saved.conta.json'), '{}');await writeFile(join(usb, 'unrelated.txt'), 'private');
  const result = await listDirectory(usb);assert.deepEqual(result.entries.map(e => e.name), ['فرع', 'saved.conta.json']);
  assert.deepEqual((await listDirectory(usb, 'فرع')).entries.map(e => e.name), ['فرع']);
  assert.equal((await resolveDestination(usb, 'جديد')).filePath, join(usb, 'جديد.conta.json'));
  await assert.rejects(resolveDestination(usb, 'saved'), {code:'EEXIST'});
});
test('save uses the chosen USB folder and name without creating the old fixed directory', async t => {
  const { home, usb } = await fixture(t);const filePath = join(usb, 'chosen.conta.json');
  const store = createBackupStore({ homeDirectory:home, chooseDestination:async()=>({filePath}) });
  const result=await store.save(async()=>json('{"data":"عطر"}'));assert.equal(result.filePath,filePath);assert.equal(await readFile(filePath,'utf8'),'{"data":"عطر"}');
  assert.equal(store.lastFilePath(), filePath);await assert.rejects(readdir(join(home,'AlKarna Backups')), {code:'ENOENT'});
});
test('canceling destination selection does not fetch or write a backup', async t => {
  const { home, usb } = await fixture(t);const store=createBackupStore({homeDirectory:home,chooseDestination:async()=>null});
  assert.deepEqual(await store.save(async()=>{throw Error('must not fetch')}),{ok:false,canceled:true});assert.deepEqual(await readdir(usb),[]);assert.equal(store.isActive(),false);
});
test('removing the chosen USB fails rather than falling back or recreating folders', async t => {
  const { home, usb } = await fixture(t);await rm(usb,{recursive:true});const store=createBackupStore({homeDirectory:home,chooseDestination:async()=>({filePath:join(usb,'copy.conta.json')})});
  await assert.rejects(store.save(async()=>{throw Error('must not fetch')}), {code:'ENOENT'});assert.deepEqual(await readdir(home),[]);
});
test('FAT/exFAT fallback saves fully when hard links are not supported', async t => {
  const { home, usb } = await fixture(t);t.mock.method(fs,'link',async()=>{throw Object.assign(Error('unsupported'),{code:'ENOTSUP'})});
  const filePath=join(usb,'fat.conta.json');const store=createBackupStore({homeDirectory:home,chooseDestination:async()=>({filePath})});
  const content=JSON.stringify({note:'ع'.repeat(3*1024*1024)});const result=await store.save(async()=>json(content));
  assert.equal(result.bytes,Buffer.byteLength(content));assert.equal(await readFile(filePath,'utf8'),content);assert.deepEqual(await readdir(usb),['fat.conta.json']);
});
test('fallback never overwrites a pre-existing file, including a destination race', async t => {
  const { home, usb } = await fixture(t);t.mock.method(fs,'link',async()=>{throw Object.assign(Error('unsupported'),{code:'EPERM'})});
  const filePath=join(usb,'old.conta.json');await writeFile(filePath,'old');const store=createBackupStore({homeDirectory:home,chooseDestination:async()=>({filePath})});
  await assert.rejects(store.save(async()=>json('{}')), {code:'EEXIST'});assert.equal(await readFile(filePath,'utf8'),'old');assert.deepEqual(await readdir(usb),['old.conta.json']);
});
test('picker cancel and hung-directory timeout remain independently available', async () => {
  await assert.rejects(deadline(new Promise(()=>{}),20),{code:'folder-timeout'});
  const frame={url:'file:///trusted/picker.html'},wc={mainFrame:frame},window={webContents:wc,isDestroyed:()=>false};const event={sender:wc,senderFrame:frame};
  assert.equal(trustedPicker(event,window,frame.url),true);assert.equal(trustedPicker(event,window,'file:///other.html'),false);assert.equal(trustedPicker({...event,sender:{}},window,frame.url),false);assert.equal(trustedPicker({...event,senderFrame:{...frame}},window,frame.url),false);
});
test('open-folder follows the actual saved directory and ignores renderer path input', async t => {
  const {home,usb}=await fixture(t);const store=createBackupStore({homeDirectory:home,chooseDestination:async()=>({filePath:join(usb,'copy.conta.json')})});
  const frame={url:'http://127.0.0.1:1000/'},wc={mainFrame:frame,session:{cookies:{get:async()=>[]}}},owner={webContents:wc,isDestroyed:()=>false},event={sender:wc,senderFrame:frame},handlers=new Map();let opened;
  registerBackupHandlers({ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},store,getWindow:()=>owner,getOrigin:()=>frame.url,fetchResponse:async()=>json('{}'),openPath:async dir=>{opened=dir;return ''}});
  assert.equal((await handlers.get('alkarna:backup:save')(event,{filePath:'attacker.json'})).ok,true);assert.equal((await handlers.get('alkarna:backup:open-folder')(event)).ok,true);assert.equal(opened,usb);
});
