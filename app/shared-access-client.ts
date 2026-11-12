export type Member={id:string;name:string;role:string;capabilities:string[]};
export type Branch={id:string;name:string};
export type Receipt={operationId:string;hash:string;status:"accepted"|"needs-settlement"|"blocked";result?:Record<string,unknown>;error?:{message?:string}};
export type PendingOrganizationAccess={stage:"pending";mode:"online";deviceStatus:"pending";installationId:string;requestId:string;identifier:string};
export type EntryResult={kind:"activation"|"organization";stage?:string};
export type AccessView={installationId:string;deviceName:string;deviceCode:string;license:{valid:boolean};request:null|{requestId:string;identifier:string;purpose:string;stage:string;expiresAt:number|null;organization?:null|{id:string;name:string}};organizationAccess:PendingOrganizationAccess|null;session:null|{organization:{id:string;name:string};member:Member;branches:Branch[]};pending:null|{operationId:string;branchId:string};receipt:Receipt|null;draft:Record<string,unknown>|null};
export type SharedProduct={id:number;globalId:string;name:string;sku:string;price:number;stocks:Record<string,number>;archived?:boolean;syncVersion?:number};
export type SharedState={originId:string;syncScope:{organizationId:string;branchId:string};products:SharedProduct[];parties:Array<{id:number;globalId:string;name:string;type:string}>;accounts:Array<{id:number;globalId:string;name:string;active:boolean}>;records:Array<{globalId:string;kind:string;number:string;total:number;voided?:boolean}>;warehouses:string[];warehouseMeta:Record<string,{globalId:string;archived?:boolean}>;salesWarehouse:string;currency:{code:string};categories:unknown[]};
export type SharedView={organizationId:string;branchId:string;epoch:number;cursor:number;view:"full"|"sales";viewHash:string;state:SharedState;hasMore?:boolean};
type Reply<T>={ok:true;value:T}|{ok:false;code:string;message:string;retryAfter?:number};
type AccessBridge={state:(branchId?:string)=>Promise<Reply<AccessView>>;enter:(input:{identifier:string;code:string;consent:boolean})=>Promise<Reply<EntryResult>>;newRequest:()=>Promise<Reply<{ready:boolean;purpose:string}>>;request:(input:Record<string,unknown>)=>Promise<Reply<unknown>>;poll:()=>Promise<Reply<unknown>>;activate:()=>Promise<Reply<unknown>>;login:(input:{identifier:string;code:string})=>Promise<Reply<unknown>>;logout:()=>Promise<Reply<unknown>>;refresh:(branchId:string)=>Promise<Reply<SharedView>>;submit:(input:Record<string,unknown>)=>Promise<Reply<Receipt>>;draft:(value:unknown)=>Promise<Reply<unknown>>;ack:(operationId:string)=>Promise<Reply<unknown>>};
declare global{interface Window{alkarnaAccess?:AccessBridge;}}
export async function accessCall<K extends keyof AccessBridge>(method:K,...args:Parameters<AccessBridge[K]>):Promise<Awaited<ReturnType<AccessBridge[K]>> extends Reply<infer T>?T:never>{
 const api=window.alkarnaAccess;if(!api)throw Error("هذه الصفحة متاحة داخل تطبيق Windows فقط / Ouvrez cette page dans l’application Windows.");
 const fn=api[method] as (...args:Parameters<AccessBridge[K]>)=>ReturnType<AccessBridge[K]>;
 const reply=await fn(...args);if(!reply.ok)throw Object.assign(Error(reply.message),{code:reply.code,retryAfter:reply.retryAfter});return reply.value as Awaited<ReturnType<AccessBridge[K]>> extends Reply<infer T>?T:never;
}

// Transient local editor drafts stay with the existing authenticated principal.
let localLoginGeneration=0;
function clearLocalLoginDrafts(){try{if(typeof sessionStorage!=="undefined")for(const key of Object.keys(sessionStorage))if(key.startsWith("conta:"))sessionStorage.removeItem(key);}catch{/* Unavailable storage cannot expose another account's cached editor. */}}
export function completeLocalLogin(scope:"same"|"changed"){localLoginGeneration++;if(scope==="changed")clearLocalLoginDrafts();}
export function watchLocalLoginDrafts(){
 let active=true;const generation=localLoginGeneration;
 void fetch("/api/license/status",{cache:"no-store",credentials:"same-origin"}).then(response=>{if(active&&generation===localLoginGeneration&&response.status===401)clearLocalLoginDrafts();}).catch(()=>{});
 return()=>{active=false;};
}
