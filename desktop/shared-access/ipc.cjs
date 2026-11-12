/* eslint-disable @typescript-eslint/no-require-imports */
const {trustedSender}=require('../native-backup.cjs');
function accessSender(event,owner,origin){if(!trustedSender(event,owner,origin))return false;try{return ['/remote-access','/remote-access/','/shared','/shared/'].includes(new URL(event.senderFrame.url).pathname);}catch{return false;}}
function registerDesktopAccessHandlers({ipcMain,client,getWindow,getOrigin,isClosing=()=>false}){
 const handlers={state:v=>client.view(v?.branchId),newRequest:()=>client.beginNewRequest(),request:v=>client.request(v),poll:()=>client.requestStatus(),activate:()=>client.acceptActivation(),login:v=>client.login(v),logout:()=>client.logout(),refresh:v=>client.refresh(v.branchId),submit:v=>client.submit(v),draft:v=>client.saveDraft(v),ack:v=>client.acknowledge(v.operationId)};
 for(const [name,handler]of Object.entries(handlers))ipcMain.handle('alkarna:access:'+name,async(event,value)=>{
  if(!accessSender(event,getWindow(),getOrigin())||isClosing())return{ok:false,code:'FORBIDDEN',message:'هذه العملية متاحة داخل نافذة ربط التطبيق فقط.'};
  try{if(value!==undefined&&Buffer.byteLength(JSON.stringify(value))>1024*1024)return{ok:false,code:'REQUEST_TOO_LARGE',message:'الطلب كبير.'};return{ok:true,value:await handler(value)};}catch(error){return{ok:false,code:error.code||'ACCESS_FAILED',message:error.message||'تعذر إكمال العملية.',retryAfter:error.retryAfter||0};}
 });
}
module.exports={accessSender,registerDesktopAccessHandlers};
