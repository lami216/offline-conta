/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {fault}=require('./protocol.cjs');
function createProtectedStore(directory,safeStorage){
 const filename=path.join(directory,'desktop-access-v1.enc');
 function ready(){if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw fault('SECURE_STORAGE_UNAVAILABLE','تعذر حماية مفتاح هذا التثبيت بواسطة نظام التشغيل.');}
 return {
  async read(){ready();try{const raw=await fs.readFile(filename);if(raw.length>8*1024*1024)throw fault('ACCESS_STATE_TOO_LARGE');const state=JSON.parse(safeStorage.decryptString(raw));if(state.schema!==1)throw fault('UNSUPPORTED_ACCESS_STATE');return state;}catch(e){if(e.code==='ENOENT')return null;throw fault('ACCESS_STATE_UNREADABLE','تعذر قراءة حالة الربط المحفوظة؛ لم تُعد تهيئتها.');}},
  async write(state){ready();const bytes=safeStorage.encryptString(JSON.stringify(state));if(bytes.length>8*1024*1024)throw fault('ACCESS_STATE_TOO_LARGE');await fs.mkdir(directory,{recursive:true,mode:0o700});const temporary=filename+'.'+randomUUID()+'.tmp';let h;try{h=await fs.open(temporary,'wx',0o600);await h.writeFile(bytes);await h.sync();await h.close();h=null;await fs.rename(temporary,filename);}catch{await h?.close().catch(()=>{});await fs.rm(temporary,{force:true}).catch(()=>{});throw fault('ACCESS_STATE_WRITE_FAILED','تعذر حفظ حالة الربط بأمان؛ لم يُرسل طلب جديد.');}}
 };
}
module.exports={createProtectedStore};
