/* eslint-disable @typescript-eslint/no-require-imports */
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createProtectedStore}=require('../desktop/shared-access/storage.cjs');
const {DesktopAccessClient}=require('../desktop/shared-access/client.cjs');
const {registerDesktopAccessHandlers}=require('../desktop/shared-access/ipc.cjs');
let directory,window,server;
async function cleanup(){window?.destroy();if(server)await new Promise(resolve=>server.close(resolve));if(directory){const target=path.resolve(directory),parent=path.resolve(os.tmpdir());if(!target.startsWith(parent+path.sep)||!path.basename(target).startsWith('alkarna-access-electron-'))throw Error('Unsafe fixture cleanup path');await fs.rm(target,{recursive:true,force:true});}}
(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'alkarna-access-electron-'));app.setPath('userData',directory);await app.whenReady();assert.equal(process.platform,'win32','This test specifically verifies Windows DPAPI');assert.equal(safeStorage.isEncryptionAvailable(),true);
 server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body>Isolated access test</body></html>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 window=new BrowserWindow({show:false,webPreferences:{preload:path.resolve(__dirname,'../desktop/preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 const client=new DesktopAccessClient({store:createProtectedStore(path.join(directory,'access'),safeStorage),config:{origin:'https://example.invalid',issuers:{}},appVersion:'fixture',localLicense:async()=>({deviceId:'AKD-1111-2222-3333-4444-5555',status:{valid:true}}),fetchResponse:async()=>{throw Error('Network must not be used');}});
 registerDesktopAccessHandlers({ipcMain,client,getWindow:()=>window,getOrigin:()=>origin});await window.loadURL(origin+'/remote-access');const allowed=await window.webContents.executeJavaScript('window.alkarnaAccess.state()');assert.equal(allowed.ok,true);assert.equal(allowed.value.license.valid,true);assert.equal(JSON.stringify(allowed).includes('privateDer'),false);const raw=await fs.readFile(path.join(directory,'access/desktop-access-v1.enc'));assert.equal(raw.includes(Buffer.from('privateDer')),false);assert.equal(raw.includes(Buffer.from(client.state.privateDer)),false);
 await window.loadURL(origin+'/login');const denied=await window.webContents.executeJavaScript('window.alkarnaAccess.state()');assert.equal(denied.ok,false);assert.equal(denied.code,'FORBIDDEN');
 const proof={passed:true,platform:'win32',realElectron:true,secureStorage:'Windows DPAPI',contextIsolation:true,sandbox:true,allowedMainPage:true,foreignPageDenied:true,networkRequests:0};if(!process.env.ALKARNA_ACCESS_PROOF_FILE)throw Error('Explicit proof output required');await fs.writeFile(process.env.ALKARNA_ACCESS_PROOF_FILE,JSON.stringify(proof,null,2)+'\n');await cleanup();app.exit(0);
})().catch(async error=>{console.error(error.message);await cleanup().catch(()=>{});app.exit(1);});
