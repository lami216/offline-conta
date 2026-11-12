import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const {DesktopAccessClient}=require('../desktop/shared-access/client.cjs');
const {canonical,hash,fingerprint}=require('../desktop/shared-access/protocol.cjs');
const now=1900000000000,device='AKD-1111-2222-3333-4444-5555',password='SYNTHETIC_ACCOUNT_SECRET';

function fixture(){
 let saved=null,localReads=0,installs=0;
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicJwk=pair.publicKey.export({format:'jwk'});
 const options={store:{read:async()=>structuredClone(saved),write:async value=>{saved=structuredClone(value);}},config:{origin:'https://service.invalid',issuers:{fixture:publicJwk}},appVersion:'fixture',now:()=>now,localLicense:async()=>{localReads++;return{deviceId:device,status:{valid:false},licenseDocument:'EXISTING_LOCAL_LICENSE'};},installLicense:async()=>{installs++;throw Error('No local licence may be issued by organization login');}};
 const setup=()=>new DesktopAccessClient(options),client=setup();
 const envelope=(schema,payload)=>{const signed={schema,version:1,kid:'fixture',payload};return{...signed,signature:sign('sha256',Buffer.from(canonical(signed)),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};};
 const active=(c,patch={})=>{
  const organization={id:'org-A',name:'Synthetic organization'},member={id:'member-A',name:'Synthetic member',role:'org-admin',capabilities:['*']},branches=[{id:'branch-A',name:'Synthetic branch'}];
  const payload={applicationId:'mr.alkarna.desktop',installationId:c.state.installationId,keyFingerprint:fingerprint(c.state.publicJwk),deviceApproval:'approved',organizationId:organization.id,memberId:member.id,role:member.role,capabilities:member.capabilities,branches,issuedAt:now,expiresAt:now+60000,...patch};
  return{sessionToken:'x'.repeat(43),sessionExpiresAt:now+60000,organization,member,branches,entitlement:envelope('contatools-desktop-online-access',payload)};
 };
 return{client,setup,envelope,active,get saved(){return saved;},get localReads(){return localReads;},get installs(){return installs;}};
}
const pending=c=>({stage:'pending',mode:'online',deviceStatus:'pending',installationId:c.state.installationId,requestId:randomUUID()});

test('one entry field normalizes the phone and always creates a standalone activation request',async()=>{
 const f=fixture();let calls=0;
 f.client.call=async(operation,payload)=>{calls++;assert.equal(operation,'request.create');assert.equal(payload.identifier,'22334455');assert.equal(payload.purpose,'activation');assert.equal(payload.code,password);return{stage:'pending',requestId:payload.requestId};};
 await assert.rejects(f.client.enter({identifier:'22334455',code:password}),{code:'CONSENT_REQUIRED'});assert.equal(calls,0);
 await assert.rejects(f.client.enter({identifier:'52334455',code:password,consent:true}),{code:'INVALID_IDENTIFIER'});assert.equal(calls,0);
 const result=await f.client.enter({identifier:' ٢٢٣٣٤٤٥٥ ',code:password,purpose:'both',consent:true});
 assert.equal(result.kind,'activation');assert.equal(result.stage,'pending');assert.equal(f.saved.request.purpose,'activation');assert.equal(f.installs,0);
});

test('fresh organization credentials produce a strict pending notice without storing or replaying the password',async()=>{
 const f=fixture();await f.client.initialize();const identity={id:f.saved.installationId,key:f.saved.privateDer},answer=pending(f.client);let calls=0;
 f.client.call=async(operation,payload)=>{calls++;assert.equal(operation,'session.login');assert.equal(payload.identifier,'employee@example.invalid');assert.equal(payload.code,password);assert.equal(payload.clientProtocol.deviceApprovalVersion,1);return answer;};
 const result=await f.client.enter({identifier:' Employee@Example.Invalid ',code:password,consent:true});
 assert.deepEqual(result,{kind:'organization',...answer});assert.equal(f.saved.session,null);assert.equal(f.saved.organizationAccess.requestId,answer.requestId);
 assert.equal(f.saved.installationId,identity.id);assert.equal(f.saved.privateDer,identity.key);assert.equal(JSON.stringify(f.saved).includes(password),false);assert.equal(f.localReads,0);assert.equal(f.installs,0);
 const restarted=f.setup();restarted.call=async()=>{throw Error('Credentials must never be replayed in the background');};
 const view=await restarted.view();assert.equal(view.session,null);assert.equal(view.organizationAccess.identifier,'employee@example.invalid');assert.equal(calls,1);assert.equal(JSON.stringify(view).includes(password),false);
});

test('pending login rejects every extra field, foreign installation, wrong mode/status and malformed request id',async()=>{
 const f=fixture();await f.client.initialize();const original=structuredClone(f.saved),valid=pending(f.client);
 const invalid=[...['sessionToken','entitlement','organization','member','branches','data'].map(key=>({...valid,[key]:null})),{...valid,installationId:randomUUID()},{...valid,mode:'offline'},{...valid,deviceStatus:'approved'},{...valid,requestId:'arbitrary'},{stage:'pending',mode:'online',deviceStatus:'pending',installationId:valid.installationId}];
 for(const response of invalid){f.client.call=async()=>response;await assert.rejects(f.client.login({identifier:'employee@example.invalid',code:password}),{code:'INVALID_SERVICE_RESPONSE'});assert.deepEqual(f.saved,original);}
});

test('only a signed approved organization entitlement admits an unlicensed Windows device',async()=>{
 const f=fixture();await f.client.initialize();const approved=f.active(f.client);
 f.client.call=async(operation)=>{assert.equal(operation,'session.login');return approved;};
 const result=await f.client.enter({identifier:'employee@example.invalid',code:password,consent:true});
 assert.equal(result.kind,'organization');assert.equal(result.organization.id,'org-A');assert.equal(f.saved.session.token,approved.sessionToken);assert.equal(f.saved.organizationAccess,null);assert.equal(f.localReads,0);assert.equal(f.installs,0);assert.equal(JSON.stringify(f.saved).includes(password),false);
});

test('legacy automatic grants, unsigned approval flags, foreign bindings and altered rights fail closed',async()=>{
 const f=fixture();await f.client.initialize();const before=structuredClone(f.saved);
 const noMarker=f.active(f.client);delete noMarker.entitlement.payload.deviceApproval;
 // Re-sign the legacy payload: a valid old service signature still cannot bypass device approval.
 noMarker.entitlement=f.envelope('contatools-desktop-online-access',noMarker.entitlement.payload);noMarker.deviceApproval='approved';
 const wrongRights=f.active(f.client);wrongRights.branches=[{id:'foreign',name:'Foreign'}];
 const forged=f.active(f.client);forged.entitlement.payload.deviceApproval='pending';
 for(const response of [noMarker,f.active(f.client,{deviceApproval:'pending'}),f.active(f.client,{installationId:randomUUID()}),f.active(f.client,{keyFingerprint:'foreign'}),wrongRights,forged]){
  f.client.call=async()=>response;await assert.rejects(f.client.login({identifier:'employee@example.invalid',code:password}));assert.deepEqual(f.saved,before);
 }
});

test('pending login cannot replace a session while its accounting command or receipt is unresolved',async()=>{
 const f=fixture();await f.client.initialize();const request={requestId:randomUUID(),identifier:'22334455',code:'PRIVATE_ACTIVATION_SECRET',purpose:'activation',stage:'linked',deviceCode:device},drafts={opaque:{number:'KEEP_LOCAL_DRAFT'}},command={operationId:randomUUID(),organizationId:'old-org',authorMemberId:'old-member',branchId:'old-branch'};
 await f.client.persist({request,drafts,pending:{command,hash:'saved-hash'},receipt:{organizationId:'old-org',authorMemberId:'old-member'},session:{token:'old-token',organization:{id:'old-org'},member:{id:'old-member'},branches:[]}});const before=structuredClone(f.saved);
 f.client.call=async()=>pending(f.client);await assert.rejects(f.client.login({identifier:'employee@example.invalid',code:password}),{code:'PENDING_COMMAND'});
 assert.deepEqual(f.saved,before);assert.equal(f.installs,0);
});

test('admin conversion uses separate email credentials without changing the standalone license or moving its drafts',async()=>{
 const f=fixture();await f.client.initialize();const request={requestId:randomUUID(),identifier:'22334455',code:'PRIVATE_PHONE_SECRET',purpose:'activation',stage:'linked',deviceCode:device},drafts={oldTenant:{number:'DO_NOT_MIGRATE'}};
 await f.client.persist({request,drafts});const identity={id:f.saved.installationId,key:f.saved.privateDer};
 f.client.call=async()=>f.active(f.client);await f.client.login({identifier:'employee@example.invalid',code:password});
 assert.deepEqual(f.saved.request,request);assert.deepEqual(f.saved.drafts,drafts);assert.equal(f.saved.installationId,identity.id);assert.equal(f.saved.privateDer,identity.key);assert.equal(f.installs,0);assert.equal(f.localReads,0);
});

test('approved conversion cannot reassign an unresolved financial command or receipt to another organization',async()=>{
 const f=fixture();await f.client.initialize();await f.client.persist({pending:{command:{organizationId:'old-org',authorMemberId:'old-member'}},receipt:null});const before=structuredClone(f.saved);
 f.client.call=async()=>f.active(f.client);await assert.rejects(f.client.login({identifier:'employee@example.invalid',code:password}),{code:'PENDING_OTHER_MEMBER'});assert.deepEqual(f.saved,before);
 await f.client.persist({pending:null,receipt:{organizationId:'old-org',authorMemberId:'old-member'}});const withReceipt=structuredClone(f.saved);
 await assert.rejects(f.client.login({identifier:'employee@example.invalid',code:password}),{code:'PENDING_OTHER_MEMBER'});assert.deepEqual(f.saved,withReceipt);
});

test('approved online reads and writes need server authorization but never open or install a local license',async()=>{
 const f=fixture();await f.client.initialize();const active=f.active(f.client);f.client.call=async()=>active;await f.client.login({identifier:'employee@example.invalid',code:password});
 const state={synthetic:true},branch={organizationId:'org-A',branchId:'branch-A',epoch:1,cursor:0,state,viewHash:hash(state)};let writes=0;
 f.client.call=async(operation,payload,useSession)=>{assert.equal(useSession,true);if(operation==='access.status')return{entitlement:active.entitlement};if(operation==='online.bootstrap')return branch;if(operation==='sync.push'){writes++;const command=payload.commands[0];return{receipts:[{operationId:command.operationId,hash:hash(command),status:'accepted'}]};}throw Error('Unexpected operation '+operation);};
 await f.client.authorized();await f.client.refresh('branch-A');const receipt=await f.client.submit({branchId:'branch-A',kind:'entity.upsert',payload:{}});assert.equal(receipt.status,'accepted');assert.equal(writes,1);assert.equal(f.localReads,0);assert.equal(f.installs,0);
 f.client.call=async()=>{throw Object.assign(Error('Device revoked'),{status:403,code:'DEVICE_REVOKED'});};await assert.rejects(f.client.refresh('branch-A'),{code:'DEVICE_REVOKED'});
});

test('unsigned organization metadata on a phone request cannot create a conversion notice',async()=>{
 const f=fixture();await f.client.initialize();await f.client.persist({request:{requestId:randomUUID(),identifier:'22334455',code:password,purpose:'activation',stage:'pending',deviceCode:device}});
 await f.client.recordRequestResponse({stage:'pending',organization:{id:'forged',name:'Forged'}});assert.equal((await f.client.view()).request.organization,null);assert.equal(f.saved.session,null);
});

test('entity creation omits an absent edit version while explicit edit versions and retry hashes remain exact',async()=>{
 const f=fixture();await f.client.initialize();f.client.call=async()=>f.active(f.client);await f.client.login({identifier:'employee@example.invalid',code:password});
 const branch={organizationId:'org-A',branchId:'branch-A',epoch:1,cursor:0,state:{}};f.client.branch=branch;
 let command;f.client.call=async(operation,payload)=>{assert.equal(operation,'sync.push');command=payload.commands[0];throw Error('Lost response after dispatch');};
 await assert.rejects(f.client.submit({branchId:'branch-A',kind:'entity.upsert',payload:{collection:'products',globalId:randomUUID(),fields:{name:'New product'}}}),/Lost response/);
 assert.equal(Object.hasOwn(command,'expectedVersion'),false);const exact=structuredClone(f.saved.pending),restarted=f.setup();await restarted.initialize();restarted.branch=branch;
 restarted.call=async(operation,payload)=>{assert.equal(operation,'sync.push');assert.deepEqual(payload.commands[0],exact.command);return{receipts:[{operationId:exact.command.operationId,hash:exact.hash,status:'accepted'}]};};
 await restarted.submit({branchId:'branch-A',retry:true});await restarted.acknowledge(exact.command.operationId);
 restarted.call=async(operation,payload)=>{assert.equal(operation,'sync.push');const update=payload.commands[0];assert.equal(update.expectedVersion,7);return{receipts:[{operationId:update.operationId,hash:hash(update),status:'accepted'}]};};
 await restarted.submit({branchId:'branch-A',kind:'entity.upsert',payload:{collection:'products',globalId:randomUUID(),fields:{name:'Existing product'}},expectedVersion:7});
 await restarted.acknowledge(restarted.state.receipt.operationId);restarted.call=async(operation,payload)=>{assert.equal(operation,'sync.push');const update=payload.commands[0];assert.equal(Object.hasOwn(update,'expectedVersion'),true);assert.equal(update.expectedVersion,0);return{receipts:[{operationId:update.operationId,hash:hash(update),status:'needs-settlement'}]};};
 await restarted.submit({branchId:'branch-A',kind:'entity.upsert',payload:{collection:'products',globalId:randomUUID(),fields:{name:'Explicit zero guard'}},expectedVersion:0});
});

test('central logout clears only a known unauthorized session and preserves standalone identity, drafts and license state',async()=>{
 for(const status of [401,403]){
  const f=fixture();await f.client.initialize();f.client.call=async()=>f.active(f.client);await f.client.login({identifier:'employee@example.invalid',code:password});
  await f.client.persist({request:{requestId:randomUUID(),purpose:'activation',stage:'linked',code:'PRIVATE_PHONE_CODE'},drafts:{saved:{number:'KEEP_UNPOSTED_DRAFT'}}});const before=structuredClone(f.saved);f.client.branch={state:{privateCentralSnapshot:true}};
  f.client.call=async(operation)=>{assert.equal(operation,'session.logout');throw Object.assign(Error('Expired or revoked'),{status});};
  assert.deepEqual(await f.client.logout(),{signedOut:true});assert.equal(f.saved.session,null);assert.equal(f.saved.organizationAccess,null);assert.equal(f.client.branch,null);
  for(const key of ['installationId','privateDer','publicJwk','request','drafts','pending','receipt'])assert.deepEqual(f.saved[key],before[key]);assert.equal(f.localReads,0);assert.equal(f.installs,0);
 }
});

test('logout never swallows network/server failures or clears a session with any unresolved intent or receipt',async()=>{
 const f=fixture();await f.client.initialize();f.client.call=async()=>f.active(f.client);await f.client.login({identifier:'employee@example.invalid',code:password});
 const branch={state:{privateCentralSnapshot:true}};f.client.branch=branch;let calls=0;
 for(const error of [Error('Network unavailable'),Object.assign(Error('Server failed'),{status:500}),Object.assign(Error('Wait'),{status:429})]){
  const before=structuredClone(f.saved);f.client.call=async()=>{calls++;throw error;};await assert.rejects(f.client.logout(),e=>e===error);assert.deepEqual(f.saved,before);assert.equal(f.client.branch,branch);
 }
 for(const blocked of [{pending:{command:{operationId:randomUUID()}},receipt:null},{pending:null,receipt:{operationId:randomUUID(),status:'accepted'}}]){
  await f.client.persist(blocked);const before=structuredClone(f.saved),beforeCalls=calls;f.client.call=async()=>{calls++;throw Object.assign(Error('Revoked'),{status:403});};
  await assert.rejects(f.client.logout(),{code:'PENDING_COMMAND'});assert.deepEqual(f.saved,before);assert.equal(calls,beforeCalls);assert.equal(f.client.branch,branch);
 }
});
