/* global document, window */
'use strict';
const api = window.backupPicker;
const el = id => document.getElementById(id);
const copy = {
  ar: {title:'حفظ النسخة الاحتياطية',subtitle:'اختر المجلد أو الفلاشة، ثم اسم الملف. لن تُستبدل أي نسخة سابقة.',home:'مجلد المستخدم',refresh:'تحديث الأقراص / USB',up:'أعلى',go:'انتقال',search:'بحث في المجلد',find:'بحث',new:'مجلد جديد',create:'إنشاء',filename:'اسم الملف',format:'نسخة الكرنه (.conta.json) — يمكنك إلغاء العملية دون تغيير البيانات.',cancel:'إلغاء',save:'حفظ هنا',loading:'جارٍ قراءة المجلد…',empty:'لا توجد مجلدات فرعية أو نسخ هنا. يمكنك الحفظ في هذا المجلد.',many:'عُرضت أول 1000 نتيجة. استخدم البحث أو اكتب المسار مباشرة.',folder:'مجلد',file:'نسخة',error:'تعذر فتح المجلد. تحقق من المسار أو اتصال الفلاشة.',exists:'يوجد ملف بهذا الاسم. اختر اسمًا آخر؛ لن نستبدل النسخة السابقة.',name:'اسم غير صالح. تجنب الرموز / \\ : * ? وجرّب اسمًا آخر.',timeout:'المجلد لا يستجيب. اختر قرصًا آخر أو ألغِ العملية.',permission:'لا توجد صلاحية للوصول إلى هذا المجلد.',busy:'انتظر انتهاء قراءة المجلد أو اضغط إلغاء.'},
  fr: {title:'Enregistrer la sauvegarde',subtitle:'Choisissez un dossier ou une clé USB, puis le nom du fichier. Les anciennes copies restent intactes.',home:'Dossier utilisateur',refresh:'Actualiser disques / USB',up:'Parent',go:'Ouvrir',search:'Rechercher dans ce dossier',find:'Chercher',new:'Nouveau dossier',create:'Créer',filename:'Nom du fichier',format:'Sauvegarde Al Karna (.conta.json) — Annuler ne modifie aucune donnée.',cancel:'Annuler',save:'Enregistrer ici',loading:'Lecture du dossier…',empty:'Aucun sous-dossier ni sauvegarde. Vous pouvez enregistrer ici.',many:'1000 résultats affichés. Recherchez ou saisissez le chemin.',folder:'Dossier',file:'Copie',error:'Dossier inaccessible. Vérifiez le chemin ou la connexion USB.',exists:'Ce fichier existe déjà. Choisissez un autre nom ; aucune copie ne sera remplacée.',name:'Nom non valide. Évitez / \\ : * ? et choisissez un autre nom.',timeout:'Ce dossier ne répond pas. Choisissez un autre disque ou annulez.',permission:'Vous n’avez pas accès à ce dossier.',busy:'Patientez pendant la lecture, ou annulez.'}
};
let text=copy.ar, current='', parent='', home='', busy=false, sequence=0;
function status(message='', error=false){el('status').textContent=message;el('status').className=error?'status error':'status'}
function errorMessage(code){return code==='EEXIST'?text.exists:code==='invalid-name'?text.name:code==='folder-timeout'?text.timeout:['EACCES','EPERM'].includes(code)?text.permission:code==='EBUSY'?text.busy:text.error}
function setBusy(value){busy=value;for(const id of ['save','up','go','search-go','create','new'])el(id).disabled=value}
async function browse(directory, query=''){
  if(busy)return;
  const id=++sequence;setBusy(true);status(text.loading);
  try{const result=await api.list(directory,query);if(id!==sequence)return;if(!result.ok)throw result;
    current=result.directory;parent=result.parent;el('path').value=current;el('files').replaceChildren();
    for(const item of result.entries){const button=document.createElement('button');button.type='button';button.textContent=`${item.directory?'▸':'·'} ${item.name}`;button.title=item.directory?text.folder:text.file;
      if(item.directory)button.onclick=()=>{el('search').value='';void browse(current.replace(/[\\/]$/,'')+'/'+item.name)};
      else{button.className='backup';button.onclick=()=>{el('filename').value=item.name;status(text.exists,true)}}
      el('files').appendChild(button)}
    status(result.truncated?text.many:result.entries.length?'':text.empty);
  }catch(error){status(errorMessage(error.code),true)}finally{setBusy(false)}
}
async function refreshDrives(){
  el('refresh-drives').disabled=true;
  try{const result=await api.drives();if(!result.ok)throw result;el('drives').replaceChildren();for(const drive of result.drives){const button=document.createElement('button');button.type='button';button.textContent=drive.name;button.onclick=()=>{el('search').value='';void browse(drive.path)};el('drives').appendChild(button)}}catch(error){status(errorMessage(error.code),true)}finally{el('refresh-drives').disabled=false}
}
el('cancel').onclick=()=>void api.cancel();
window.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();void api.cancel()}});
el('home').onclick=()=>{el('search').value='';void browse(home)};
el('up').onclick=()=>{el('search').value='';void browse(parent||home)};
el('go').onclick=()=>{el('search').value='';void browse(el('path').value)};
el('path').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();el('go').click()}};
el('refresh-drives').onclick=()=>void refreshDrives();
el('search-go').onclick=()=>void browse(current,el('search').value);
el('search').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();el('search-go').click()}};
el('new').onclick=()=>{el('new-row').hidden=!el('new-row').hidden;if(!el('new-row').hidden)el('new-name').focus()};
el('create').onclick=async()=>{if(busy)return;setBusy(true);try{const result=await api.mkdir(current,el('new-name').value);if(!result.ok)throw result;el('new-row').hidden=true;el('new-name').value='';setBusy(false);await browse(result.directory)}catch(error){status(errorMessage(error.code),true)}finally{setBusy(false)}};
el('save').onclick=async()=>{if(busy)return;setBusy(true);try{
  // Honour a pasted location even when the user did not press "Open" first.
  const result=await api.select(el('path').value,el('filename').value);if(!result.ok)throw result;
}catch(error){status(errorMessage(error.code),true);setBusy(false)}};
async function start(){const data=await api.init();if(!data.ok)throw data;text=copy[data.locale]||copy.ar;document.documentElement.lang=data.locale;document.documentElement.dir=data.locale==='fr'?'ltr':'rtl';document.title=text.title;
  for(const [id,key]of Object.entries({title:'title',subtitle:'subtitle',home:'home','refresh-drives':'refresh',up:'up',go:'go','search-go':'find',new:'new',create:'create','filename-label':'filename',format:'format',cancel:'cancel',save:'save'}))el(id).textContent=text[key];
  el('path').ariaLabel=data.locale==='fr'?'Chemin du dossier':'مسار المجلد';el('search').placeholder=text.search;el('search').ariaLabel=text.search;el('new-name').ariaLabel=text.new;el('files').ariaLabel=text.folder;
  home=data.home;el('filename').value=data.filename;el('path').value=data.directory;void refreshDrives();await browse(data.directory);el('filename').focus();el('filename').select();
}
void start().catch(()=>status(text.error,true));
