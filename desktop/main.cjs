/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const net = require('node:net');
let window; let server;
const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus()}});
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});s.on('error',reject)});
async function start(){
 const port=await freePort(); const userData=app.getPath('userData');
 const root=app.isPackaged?join(process.resourcesPath,'app'):process.cwd();
 const entry=app.isPackaged?join(root,'server.js'):join(root,'node_modules','next','dist','bin','next');
 const args=app.isPackaged?[entry]:[entry,'dev','-H','127.0.0.1','-p',String(port)];
 server=spawn(process.execPath,args,{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_ENV:app.isPackaged?'production':'development',HOSTNAME:'127.0.0.1',PORT:String(port),ALKARNA_USER_DATA:userData,ALKARNA_DATABASE_PATH:join(userData,'data','alkarna.sqlite')},stdio:'ignore',windowsHide:true});
 const url=`http://127.0.0.1:${port}`;for(let i=0;i<120;i++){try{if((await fetch(`${url}/api/health`)).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
 window=new BrowserWindow({title:'الكرنة',width:1500,height:900,minWidth:1100,minHeight:700,icon:join(root,'public','alkarna-logo.png'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 Menu.setApplicationMenu(null);window.webContents.setWindowOpenHandler(({url:target})=>{if(target.startsWith(url))return{action:'allow'};shell.openExternal(target);return{action:'deny'}});window.webContents.on('will-navigate',(event,target)=>{if(!target.startsWith(url))event.preventDefault()});await window.loadURL(url);window.maximize();
}
app.whenReady().then(start).catch(error=>{require('electron').dialog.showErrorBox('الكرنة',String(error));app.quit()});
app.on('before-quit',()=>server?.kill());app.on('window-all-closed',()=>{server?.kill();app.quit()});
