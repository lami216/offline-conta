import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFile, mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportNativeBackup } from '../app/backup-export.ts';
const require=createRequire(import.meta.url);
const fs=require('node:fs/promises');
const {createBackupStore}=require('../desktop/backup-store.cjs');
const {createCloseFlow}=require('../desktop/close-flow.cjs');
const {createBackupPicker}=require('../desktop/backup-picker.cjs');

test('cancel is neither success nor an error and never falls back to the browser',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{alkarnaBackup:{save:async()=>({ok:false,canceled:true})}}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window});
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('unexpected download')});
 assert.deepEqual(await exportNativeBackup('ar'),{saved:false,filePath:null,canceled:true});
 assert.equal(fetch.mock.callCount(),0);
});
test('canceling the destination on exit keeps the application open without an error prompt',async()=>{
 let quits=0,failures=0,prompts=0;
 const flow=createCloseFlow({dialog:{showMessageBox:async()=>{prompts++;return{response:0}},showSaveDialog:()=>{throw Error('native picker must not run')}},window:()=>null,saveBackup:async()=>({ok:false,canceled:true}),approveQuit:async()=>{quits++},onFailure:async()=>{failures++}});
 assert.equal(await flow.requestClose(),false);assert.equal(quits,0);assert.equal(failures,0);assert.equal(prompts,1);assert.equal(flow.isActive(),false);
});
test('canceled safety backup prevents restore submission, with no false success copy',async()=>{
 const app=await readFile(new URL('../app/conta-app.tsx',import.meta.url),'utf8');
 assert.match(app,/const safety=await download\(\);if\(safety.canceled\)return;await request\("\/api\/settings\/restore"/);
 assert.match(app,/setMessage\(result.canceled\?"":result.saved\?/);
 assert.ok(!app.includes('حفظ مباشر في AlKarna Backups داخل مجلد المستخدم'));
});
test('Windows EISDIR for unsupported exFAT hard links uses the exclusive-copy fallback',async t=>{
 const home=await mkdtemp(join(tmpdir(),'backup-exfat-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const usb=join(home,'USB');await mkdir(usb);const filePath=join(usb,'chosen.conta.json');
 t.mock.method(fs,'link',async()=>{throw Object.assign(Error('WinError 1'),{code:'EISDIR'})});
 const store=createBackupStore({homeDirectory:home,chooseDestination:async()=>({filePath})});
 const result=await store.save(async()=>new Response('{"usb":true}',{headers:{'content-type':'application/json'}}));
 assert.equal(result.filePath,filePath);assert.equal(await readFile(filePath,'utf8'),'{"usb":true}');assert.deepEqual(await readdir(usb),['chosen.conta.json']);
});
test('picker assets are packaged and desktop saves always request a destination',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 for(const name of ['backup-picker.cjs','backup-picker-preload.cjs','backup-picker.html','backup-picker-ui.js'])assert.ok(pkg.build.files.includes('desktop/'+name),name);
 const main=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');assert.match(main,/chooseDestination:\(\)=>backupPicker.choose\(\)/);
 const html=await readFile(new URL('../desktop/backup-picker.html',import.meta.url),'utf8');assert.match(html,/script-src 'self'/);assert.match(html,/connect-src 'none'/);
});
test('isolated picker accepts only its packaged main frame and resolves an explicit selection',async t=>{
 const home=await mkdtemp(join(tmpdir(),'picker-integration-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const handlers=new Map(),windows=[];
 class FakeWindow extends EventEmitter{
  constructor(options){super();this.options=options;this.destroyed=false;this.webContents=new EventEmitter();this.webContents.mainFrame={url:''};this.webContents.session={setPermissionRequestHandler:()=>{}};this.webContents.setWindowOpenHandler=fn=>{this.openHandler=fn};windows.push(this)}
  isDestroyed(){return this.destroyed}
  show(){}
  close(){this.destroyed=true;this.emit('closed')}
  destroy(){this.close()}
  async loadFile(file){this.webContents.mainFrame.url=pathToFileURL(file).href;queueMicrotask(()=>this.emit('ready-to-show'))}
 }
 const picker=createBackupPicker({BrowserWindow:FakeWindow,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},getOwner:()=>({isDestroyed:()=>false}),homeDirectory:home});
 const pending=picker.choose();await new Promise(resolve=>setImmediate(resolve));const window=windows[0],handler=handlers.get('alkarna:backup-picker');
 assert.equal(window.options.webPreferences.sandbox,true);assert.equal(window.options.webPreferences.contextIsolation,true);assert.equal(window.options.webPreferences.nodeIntegration,false);assert.equal(window.openHandler().action,'deny');
 const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
 assert.equal((await handler({sender:{},senderFrame:event.senderFrame},{action:'select',directory:home,filename:'attack'})).ok,false);
 await assert.rejects(picker.choose(),/backup-busy/);
 assert.equal((await handler(event,{action:'init'})).directory,home);
 await handler(event,{action:'select',directory:home,filename:'selected'});
 assert.deepEqual(await pending,{filePath:join(home,'selected.conta.json')});
 assert.deepEqual(await readdir(home),[],'selection alone never writes database bytes');
 const next=picker.choose();await new Promise(resolve=>setImmediate(resolve));const second=windows[1];await handler({sender:second.webContents,senderFrame:second.webContents.mainFrame},{action:'cancel'});assert.equal(await next,null);
});
