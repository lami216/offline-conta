from pathlib import Path
import subprocess

expected = {
 'app/conta-app.tsx': 'ffb95f8f512c0c27476bdebdf3d57623cbcecf32',
 'desktop/main.cjs': '97512e26790c9020764f344f08c216b1f3d6d4df',
 'desktop/preload.cjs': '55049bf1b54eb06b273e8071b500270765c76585',
 'desktop/close-flow.cjs': '1b9bacd7ada9bd57c5c1e78a76255b07f7fe4306',
 'package.json': 'b19bfe8b3284c34108e95de4d6a0e7d9bffff0a4',
}
for file, sha in expected.items():
 actual = subprocess.check_output(['git', 'hash-object', file], text=True).strip()
 if actual != sha: raise RuntimeError(f'Refusing to patch changed source: {file} ({actual})')
files = {p: Path(p).read_text(encoding='utf-8') for p in expected}
def replace(p, old, new, count=1):
 if files[p].count(old) != count: raise RuntimeError(f'Expected {count} patch site(s): {p}: {old[:80]}')
 files[p] = files[p].replace(old, new)

replace('desktop/main.cjs', "const PRODUCT_NAME='الكرنه';", "const {createBackupStore,registerBackupHandlers}=require('./backup-store.cjs');\nconst PRODUCT_NAME='الكرنه';")
replace('desktop/main.cjs', "let window,server,quitting=false,ready=false,logStream,logPath,closeFlow,serverUrl;", "let window,server,quitting=false,ready=false,logStream,logPath,closeFlow,serverUrl,backupStore;")
replace('desktop/main.cjs', 'async function start(){\n registerPrintingHandlers();', '''async function requestDesktopClose(){
 try{await backupStore?.waitForIdle()}catch{/* Save failure is already reported; keep the normal close choice. */}
 return closeFlow.requestClose();
}
async function start(){
 registerPrintingHandlers();
 backupStore=createBackupStore({homeDirectory:app.getPath('home'),log:stamp});
 registerBackupHandlers({ipcMain,store:backupStore,getWindow:()=>window,getOrigin:()=>serverUrl,fetchResponse:fetch,openPath:path=>shell.openPath(path),isClosing:()=>quitting||Boolean(closeFlow?.isActive())});''')
replace('desktop/main.cjs', 'closeFlow=createCloseFlow({dialog,window:()=>window,fetchBackup:', "closeFlow=createCloseFlow({dialog,window:()=>window,backupDirectory:backupStore.directory,saveBackup:()=>backupStore.save(signal=>fetch(`${serverUrl}/api/desktop/backup`,{signal,redirect:'error',headers:{'x-alkarna-desktop-token':desktopToken,'accept-encoding':'identity'}})),fetchBackup:")
replace('desktop/main.cjs', 'void closeFlow.requestClose().then', 'void requestDesktopClose().then', 2)

files['desktop/preload.cjs'] += '''\n// Backup-only bridge: no arbitrary file paths, URLs, bytes or admin token.
contextBridge.exposeInMainWorld('alkarnaBackup', {
  save: () => ipcRenderer.invoke('alkarna:backup:save'),
  openFolder: () => ipcRenderer.invoke('alkarna:backup:open-folder'),
});
'''
replace('package.json', '      "desktop/close-flow.cjs",', '      "desktop/close-flow.cjs",\n      "desktop/backup-store.cjs",')
replace('desktop/close-flow.cjs', 'approveQuit,onFailure,getLocale=', 'approveQuit,onFailure,saveBackup,backupDirectory,getLocale=')
replace('desktop/close-flow.cjs', 'message:copy.message,buttons:copy.buttons', "message:copy.message,detail:saveBackup?(locale==='fr'?`La sauvegarde sera enregistrée sans sélecteur de fichiers dans :\\n${backupDirectory}`:`ستُحفظ النسخة دون نافذة استعراض المجلدات في:\\n${backupDirectory}`):undefined,buttons:copy.buttons")
old = '''   const saved=await dialog.showSaveDialog(windowValue(),{title:copy.saveTitle,defaultPath:backupFilename(),filters:[{name:copy.filterName,extensions:['conta.json','json']}]});
   if(saved.canceled||!saved.filePath)return false;
   try{const bytes=await fetchBackup();await writeBackup(saved.filePath,bytes)}catch(error){await onFailure(error);await dialog.showMessageBox(windowValue(),{type:'error',title:copy.title,message:copy.failure,buttons:[copy.ok],defaultId:0,cancelId:0,noLink:true});return false}'''
new = '''   try{
    if(saveBackup){await saveBackup()}
    else{
     const saved=await dialog.showSaveDialog(windowValue(),{title:copy.saveTitle,defaultPath:backupFilename(),filters:[{name:copy.filterName,extensions:['conta.json','json']}]});
     if(saved.canceled||!saved.filePath)return false;
     const bytes=await fetchBackup();await writeBackup(saved.filePath,bytes);
    }
   }catch(error){await onFailure(error);await dialog.showMessageBox(windowValue(),{type:'error',title:copy.title,message:copy.failure,buttons:[copy.ok],defaultId:0,cancelId:0,noLink:true});return false}'''
replace('desktop/close-flow.cjs', old, new)

replace('app/conta-app.tsx', 'import { readApiResponse } from "./api-response";', 'import { readApiResponse } from "./api-response";\nimport { desktopBackupAvailable, exportNativeBackup, openBackupFolder } from "./backup-export";')
replace('app/conta-app.tsx', '  const request=async(url:string,file:File)=>readApiResponse', '''  const [lastBackup,setLastBackup]=useState(""),[desktopBackup,setDesktopBackup]=useState(false);
  useEffect(()=>{setDesktopBackup(desktopBackupAvailable())},[]);
  const request=async(url:string,file:File)=>readApiResponse''')
old = '''  const download=async()=>{const response=await fetch("/api/settings/backup");if(!response.ok)throw new Error(tr("تعذر إنشاء النسخة"));const blob=await response.blob(),link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=response.headers.get("content-disposition")?.match(/filename="([^"]+)/)?.[1]??"conta-backup.conta.json";link.click();URL.revokeObjectURL(link.href);};'''
new = '''  const download=async()=>{setLastBackup("");const result=await exportNativeBackup(locale);setLastBackup(result.filePath??"");return result;};'''
replace('app/conta-app.tsx', old, new)
old = '''onClick={()=>{setBusy("backup");download().then(()=>setMessage(tr("تم إنشاء النسخة وتنزيلها"))).catch(e=>setFailure(e.message)).finally(()=>setBusy(""))}}>{busy==="backup"?tr("جاري الإنشاء…"):tr("إنشاء وتنزيل")}</button></div></FramedSection>'''
new = '''onClick={()=>{setBusy("backup");setMessage("");setFailure("");download().then(result=>setMessage(result.saved?(locale==="ar"?"تم حفظ النسخة الاحتياطية على الجهاز.":"La sauvegarde a été enregistrée sur cet ordinateur."):(locale==="ar"?"تم بدء التنزيل في المتصفح؛ تأكد من اكتمال حفظ الملف.":"Téléchargement lancé ; vérifiez la fin de l’enregistrement."))).catch(e=>setFailure(e.message)).finally(()=>setBusy(""))}}>{busy==="backup"?tr("جاري الإنشاء…"):desktopBackup?(locale==="ar"?"إنشاء وحفظ": "Créer et enregistrer"):tr("إنشاء وتنزيل")}</button>{desktopBackup&&<small style={{display:"block",marginTop:8}}>{locale==="ar"?"حفظ مباشر في AlKarna Backups داخل مجلد المستخدم، دون نافذة ويندوز. انسخ النسخة لاحقًا إلى مكان آمن خارج الجهاز.":"Enregistrement direct dans AlKarna Backups, sous votre dossier utilisateur, sans sélecteur Windows. Conservez aussi une copie hors de cet ordinateur."}</small>}</div></FramedSection>'''
replace('app/conta-app.tsx', old, new)
old = '''{(message||failure)&&<div className="settings-feedback">{message&&<div className="success">{message}</div>}{failure&&<div className="error">{failure}</div>}</div>}'''
new = '''{(message||failure||lastBackup)&&<div className="settings-feedback">{message&&<div className="success">{message}</div>}{failure&&<div className="error">{failure}</div>}{lastBackup&&<div style={{display:"grid",gap:8,minWidth:0}}><strong>{locale==="ar"?"مكان النسخة المحفوظة":"Emplacement de la sauvegarde"}</strong><bdi dir="ltr" style={{overflowWrap:"anywhere",userSelect:"text"}}>{lastBackup}</bdi><button className="soft" type="button" disabled={!!busy} onClick={()=>void openBackupFolder().catch(e=>setFailure(e.message))}>{locale==="ar"?"فتح مجلد النسخ":"Ouvrir le dossier des sauvegardes"}</button></div>}</div>}'''
replace('app/conta-app.tsx', old, new)
for p, text in files.items(): Path(p).write_text(text, encoding='utf-8')

with Path('tests/desktop-close-backup.test.mjs').open('a', encoding='utf-8') as f:
 f.write('''

test("direct backup on exit never invokes a native file picker and waits for the saved file",async()=>{
 let release,quits=0;const dialogs=[];
 const saved=new Promise(resolve=>{release=resolve});
 const flow=createCloseFlow({dialog:{showMessageBox:async(_owner,options)=>{dialogs.push(options);return{response:0}},showSaveDialog:()=>{throw Error("must not invoke shell picker")}},window:()=>null,getLocale:async()=>"fr",backupDirectory:"C:/Users/Test/AlKarna Backups",saveBackup:()=>saved,approveQuit:async()=>{quits++},onFailure:async()=>{}});
 const pending=flow.requestClose();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(quits,0);assert.equal(flow.isActive(),true);assert.equal(await flow.requestClose(),false);
 release({ok:true,filePath:"backup.conta.json"});assert.equal(await pending,true);assert.equal(quits,1);
 assert.match(dialogs[0].detail,/AlKarna Backups/);
});
test("direct backup failure on exit keeps the application open",async()=>{
 let quits=0,failures=0;const flow=createCloseFlow({dialog:{showMessageBox:async()=>({response:0})},window:()=>null,saveBackup:async()=>{throw Error("disk-full")},approveQuit:async()=>{quits++},onFailure:async()=>{failures++}});
 assert.equal(await flow.requestClose(),false);assert.equal(quits,0);assert.equal(failures,1);
});
test("settings uses acknowledged desktop backups and the helper is included in the Windows shell",async()=>{
 const app=await readFile(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),main=await readFile(new URL("../desktop/main.cjs",import.meta.url),"utf8"),preload=await readFile(new URL("../desktop/preload.cjs",import.meta.url),"utf8"),pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
 assert.match(app,/await exportNativeBackup\\(locale\\)/);assert.match(app,/result.saved/);
 assert.match(main,/saveBackup:.*backupStore.save/);assert.match(main,/await backupStore\\?\\.waitForIdle\\(\\)/);
 assert.match(preload,/exposeInMainWorld\\('alkarnaBackup'/);assert.ok(pkg.build.files.includes("desktop/backup-store.cjs"));
});
''')
print('Applied bounded source patches; no accounting/API/database files changed.')
