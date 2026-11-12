import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {sqliteHarness} from './sqlite-harness.mjs';
const require=createRequire(import.meta.url),{DesktopAccessClient}=require('../desktop/shared-access/client.cjs'),{canonical,hash,fingerprint}=require('../desktop/shared-access/protocol.cjs');
const {remoteEntryKind}=await import('../app/login/login-routing.ts');
let harness,prepare,auth,login,accountRoute,originalSeed;
before(async()=>{harness=await sqliteHarness();originalSeed={warehouses:harness.db.native.prepare('SELECT * FROM warehouses').all(),payment_accounts:harness.db.native.prepare('SELECT * FROM payment_accounts').all()};prepare=(await import('../lib/desktop-access-local-account.ts')).prepareRemoteLocalAccount;auth=await import('../lib/auth.ts');login=(await import('../app/api/auth/login/route.ts')).POST;accountRoute=(await import('../app/api/desktop/access/account/route.ts')).POST;});
after(async()=>{await harness.close();});
const document='SYNTHETIC-INSTALLED-LICENSE',license={valid:true,license:{customerName:'Synthetic owner'}},input={identifier:'22334455',code:'PRIVATE-LOCAL-CODE',licenseDocumentHash:createHash('sha256').update(document).digest('hex')};
const uiLogin=(username,password,cookie='')=>new Request('http://127.0.0.1:3219/api/auth/login',{method:'POST',headers:{origin:'http://127.0.0.1:3219',host:'127.0.0.1:3219','x-alkarna-login-ui':'1',...(cookie?{cookie}:{})},body:new URLSearchParams({username,password})});

test('normal identifiers do not discover or invoke the remote activation path',async()=>{
 for(const value of ['arbitrary-user','52334455','12345678','2233445','223344555','x@y',''])assert.equal(remoteEntryKind(value),'none');
 assert.equal(remoteEntryKind(' ٢٢٣٣٤٤٥٥ '),'phone');assert.equal(remoteEntryKind('۴۲۳۳۴۴۵۵'),'phone');assert.equal(remoteEntryKind('Employee@Example.Invalid'),'organization');
 let network=0,writes=0;const client=new DesktopAccessClient({store:{read:async()=>null,write:async()=>{writes++;}},config:{origin:'https://service.invalid',issuers:{}},appVersion:'fixture',fetchResponse:async()=>{network++;throw Error('Unexpected network');}});
 for(const identifier of ['arbitrary-user','52334455'])await assert.rejects(client.enter({identifier,code:'PRIVATE-CODE',consent:true}),{code:'INVALID_IDENTIFIER'});
 assert.equal(network,0);assert.equal(writes,0);
});

test('verified fresh activation creates only its local credentials and retries preserve the exact password hash',async()=>{
 const before=harness.db.native.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
 assert.deepEqual(await prepare(harness.db,input,license,document),{ready:true,created:true,preserved:false});
 const user=await harness.db.collection('users').findOne({usernameNormalized:input.identifier});assert.ok(auth.verifyPasswordHash(input.code,user.passwordHash));assert.equal(user.owner,false);assert.deepEqual(user.permissions,[...auth.CAPABILITIES]);
 const original=JSON.stringify(user);assert.equal((await prepare(harness.db,input,license,document)).created,false);assert.equal(JSON.stringify(await harness.db.collection('users').findOne({usernameNormalized:input.identifier})),original);assert.deepEqual(harness.db.native.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),before);
 process.env.ALKARNA_DESKTOP='1';const authenticated=await login(uiLogin(input.identifier,input.code));assert.equal(authenticated.status,200);assert.equal((await authenticated.json()).ok,true);assert.ok(authenticated.headers.get('set-cookie'));
});

test('existing active or inactive local accounts are never replaced by a phone request',async()=>{
 for(const isActive of [true,false]){await harness.reset();const existing={id:'old',username:'old-user',usernameNormalized:'old-user',name:'Original owner',passwordHash:auth.hashPassword('OLD-PASSWORD'),isActive,permissions:['pos.view'],owner:false,createdAt:'2020-01-01'};await harness.db.collection('users').insertOne(existing);const before=harness.db.native.prepare('SELECT * FROM users').all();
  const result=await prepare(harness.db,input,license,document);assert.equal(result.ready,false);assert.equal(result.preserved,true);assert.deepEqual(harness.db.native.prepare('SELECT * FROM users').all(),before);assert.equal(await harness.db.collection('users').countDocuments(),1);
 }
});

test('a userless existing ledger or nonzero balance cannot be silently claimed by remote activation',async()=>{
 for(const collection of ['documents','products','parties','financialMovements']){await harness.reset();await harness.db.collection(collection).insertOne({id:'existing',amount:81,sentinel:'KEEP-EXACT'});const before=JSON.stringify(await harness.db.collection(collection).find().toArray());const result=await prepare(harness.db,input,license,document);assert.equal(result.reason,'EXISTING_LOCAL_DATA');assert.equal(await harness.db.collection('users').countDocuments(),0);assert.equal(JSON.stringify(await harness.db.collection(collection).find().toArray()),before);}
 await harness.reset();await harness.db.collection('paymentAccounts').insertOne({id:'account-cash',balance:53});assert.equal((await prepare(harness.db,input,license,document)).reason,'EXISTING_LOCAL_DATA');assert.equal(await harness.db.collection('users').countDocuments(),0);
 for(const[table,key,patch]of [['warehouses','wh-main',{name:'EXISTING CUSTOM STORE'}],['warehouses','wh-main',{isSalesDefault:true}],['warehouses','wh-main',{extraMetadata:'PRIVATE'}],['payment_accounts','account-cash',{name:'EXISTING ACCOUNT'}],['payment_accounts','account-cash',{code:'custom'}],['payment_accounts','account-cash',{isActive:false}],['payment_accounts','account-cash',{balanceInitialized:false}]]){
  await harness.reset();for(const[seedTable,rows]of Object.entries(originalSeed))for(const row of rows)harness.db.native.prepare(`INSERT INTO ${seedTable}(record_key,data_json) VALUES(?,?)`).run(row.record_key,row.data_json);
  const row=harness.db.native.prepare(`SELECT data_json FROM ${table} WHERE record_key=?`).get(key);harness.db.native.prepare(`UPDATE ${table} SET data_json=? WHERE record_key=?`).run(JSON.stringify({...JSON.parse(row.data_json),...patch}),key);
  const before=JSON.stringify({warehouses:harness.db.native.prepare('SELECT * FROM warehouses').all(),accounts:harness.db.native.prepare('SELECT * FROM payment_accounts').all()});assert.equal((await prepare(harness.db,input,license,document)).reason,'EXISTING_LOCAL_DATA',JSON.stringify(patch));assert.equal(await harness.db.collection('users').countDocuments(),0);assert.equal(JSON.stringify({warehouses:harness.db.native.prepare('SELECT * FROM warehouses').all(),accounts:harness.db.native.prepare('SELECT * FROM payment_accounts').all()}),before);
 }
 for(const[table,insert]of [['product_stocks',"INSERT INTO product_stocks(product_id,warehouse_id,quantity) VALUES('EXISTING-PRODUCT','EXISTING-WAREHOUSE',19)"],['document_lines',"INSERT INTO document_lines(id,document_id,product_id,quantity,unit_price,line_total) VALUES('EXISTING-LINE','EXISTING-DOC','EXISTING-PRODUCT',3,700,2100)"]]){
  await harness.reset();harness.db.native.exec(insert);const before=JSON.stringify(harness.db.native.prepare(`SELECT * FROM ${table}`).all());assert.equal((await prepare(harness.db,input,license,document)).reason,'EXISTING_LOCAL_DATA');assert.equal(await harness.db.collection('users').countDocuments(),0);assert.equal(JSON.stringify(harness.db.native.prepare(`SELECT * FROM ${table}`).all()),before);harness.db.native.exec(`DELETE FROM ${table}`);
 }
 for(const table of ['unexpected_local_history','sqliteCustomerHistory']){await harness.reset();harness.db.native.exec(`CREATE TABLE ${table}(value TEXT);INSERT INTO ${table} VALUES('KEEP')`);assert.equal((await prepare(harness.db,input,license,document)).reason,'EXISTING_LOCAL_DATA');assert.equal(await harness.db.collection('users').countDocuments(),0);assert.equal(harness.db.native.prepare(`SELECT value FROM ${table}`).get().value,'KEEP');harness.db.native.exec(`DROP TABLE ${table}`);}
});

test('a wrong document hash, invalid license or malformed credentials cannot create a local account',async()=>{
 await harness.reset();for(const [candidate,status,content]of [[{...input,licenseDocumentHash:'0'.repeat(64)},license,document],[input,{valid:false},document],[input,license,null],[{...input,identifier:'random'},license,document]])await assert.rejects(prepare(harness.db,candidate,status,content));assert.equal(await harness.db.collection('users').countDocuments(),0);
});

test('concurrent first-account deliveries create one immutable credential identity',async()=>{
 await harness.reset();const results=await Promise.all([prepare(harness.db,input,license,document),prepare(harness.db,input,license,document)]);assert.equal(results.filter(result=>result.created).length,1);assert.ok(results.every(result=>result.ready));assert.equal(await harness.db.collection('users').countDocuments(),1);
 const user=JSON.stringify(await harness.db.collection('users').findOne({usernameNormalized:input.identifier}));assert.equal((await prepare(harness.db,{...input,identifier:'33445566',code:'ANOTHER-CODE'},license,document)).ready,false);assert.equal(JSON.stringify(await harness.db.collection('users').findOne({usernameNormalized:input.identifier})),user);
});

test('local auth distinguishes inactive accounts and preserves same-user drafts while isolating changed local identities',async()=>{
 await harness.reset();process.env.ALKARNA_DESKTOP='1';let reply=await login(uiLogin('unknown@example.invalid','PRIVATE-CODE'));assert.equal(reply.headers.get('x-alkarna-local-account'),'unknown');assert.deepEqual(await reply.json(),{ok:false,field:'username',error:'اسم المستخدم غير صحيح'});
 await harness.db.collection('users').insertOne({id:'inactive',username:'employee@example.invalid',usernameNormalized:'employee@example.invalid',isActive:false,passwordHash:auth.hashPassword('LOCAL-SECRET')});reply=await login(uiLogin('employee@example.invalid','LOCAL-SECRET'));assert.equal(reply.headers.get('x-alkarna-local-account'),'known');assert.equal(reply.status,401);assert.deepEqual(await reply.json(),{ok:false,field:'username',error:'اسم المستخدم غير صحيح'});
 for(const user of [{id:'A',username:'local-a',owner:false},{id:'B',username:'local-b',owner:false},{id:'owner',username:'local-owner',owner:true}])await harness.db.collection('users').insertOne({...user,usernameNormalized:user.username,name:user.username,isActive:true,passwordHash:auth.hashPassword('SAME-LOCAL-PASSWORD'),permissions:['pos.view']});
 const before=JSON.stringify(harness.db.native.prepare('SELECT * FROM users ORDER BY record_key').all());const first=await login(uiLogin('local-a','SAME-LOCAL-PASSWORD')),aCookie=first.headers.get('set-cookie').split(';')[0];assert.equal(first.headers.get('x-alkarna-local-account-change'),'changed');assert.deepEqual(await first.json(),{ok:true});
 assert.equal((await login(uiLogin('local-a','SAME-LOCAL-PASSWORD',aCookie))).headers.get('x-alkarna-local-account-change'),'same');assert.equal((await login(uiLogin('local-b','SAME-LOCAL-PASSWORD',aCookie))).headers.get('x-alkarna-local-account-change'),'changed');
 const owner=await login(uiLogin('local-owner','SAME-LOCAL-PASSWORD')),ownerCookie=owner.headers.get('set-cookie').split(';')[0];assert.equal((await login(uiLogin('local-owner','SAME-LOCAL-PASSWORD',ownerCookie))).headers.get('x-alkarna-local-account-change'),'same');assert.equal(JSON.stringify(harness.db.native.prepare('SELECT * FROM users ORDER BY record_key').all()),before);
 const {watchLocalLoginDrafts,completeLocalLogin}=await import('../app/shared-access-client.ts'),originalFetch=globalThis.fetch,storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),storage={'conta:purchase-lines':'KEEP-UNSAVED','unrelated':'KEEP-OTHER','native:receipt':'DO-NOT-TOUCH'};Object.defineProperty(storage,'removeItem',{value:key=>{delete storage[key];},enumerable:false});Object.defineProperty(globalThis,'sessionStorage',{value:storage,configurable:true});const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  for(const status of [200,500]){globalThis.fetch=async()=>new Response('',{status});const stop=watchLocalLoginDrafts();await tick();stop();assert.equal(storage['conta:purchase-lines'],'KEEP-UNSAVED');}
  globalThis.fetch=async()=>{throw Error('Offline');};let stop=watchLocalLoginDrafts();await tick();stop();assert.equal(storage['conta:purchase-lines'],'KEEP-UNSAVED');completeLocalLogin('same');assert.equal(storage['conta:purchase-lines'],'KEEP-UNSAVED');
  let respond;globalThis.fetch=()=>new Promise(resolve=>{respond=resolve;});stop=watchLocalLoginDrafts();completeLocalLogin('same');respond(new Response('',{status:401}));await tick();stop();assert.equal(storage['conta:purchase-lines'],'KEEP-UNSAVED','stale pre-login401 must not erase a confirmed same-user draft');
  globalThis.fetch=async()=>new Response('',{status:401});stop=watchLocalLoginDrafts();await tick();stop();assert.equal('conta:purchase-lines' in storage,false);storage['conta:purchase-lines']='KEEP-UNSAVED';completeLocalLogin('changed');assert.equal('conta:purchase-lines' in storage,false);assert.equal(storage.unrelated,'KEEP-OTHER');assert.equal(storage['native:receipt'],'DO-NOT-TOUCH');
 }finally{globalThis.fetch=originalFetch;if(storageDescriptor)Object.defineProperty(globalThis,'sessionStorage',storageDescriptor);else delete globalThis.sessionStorage;}
});

test('local setup rejects browser origins, cookies, missing or wrong native tokens before any data change',async()=>{
 await harness.reset();process.env.ALKARNA_DESKTOP='1';process.env.ALKARNA_DESKTOP_TOKEN='SYNTHETIC-MAIN-ONLY-TOKEN';
 for(const headers of [{},{'x-alkarna-desktop-token':'wrong'},{'x-alkarna-desktop-token':process.env.ALKARNA_DESKTOP_TOKEN,origin:'http://127.0.0.1:3219'},{'x-alkarna-desktop-token':process.env.ALKARNA_DESKTOP_TOKEN,cookie:'conta_session=arbitrary'}]){const response=await accountRoute(new Request('http://127.0.0.1:3219/api/desktop/access/account',{method:'POST',headers,body:JSON.stringify(input)}));assert.equal(response.status,403);}
 const oversized=await accountRoute(new Request('http://127.0.0.1:3219/api/desktop/access/account',{method:'POST',headers:{'x-alkarna-desktop-token':process.env.ALKARNA_DESKTOP_TOKEN,'content-length':'5000'},body:'x'.repeat(5000)}));assert.equal(oversized.status,413);assert.equal(await harness.db.collection('users').countDocuments(),0);
});

test('a lost local setup callback retries the same signed activation without returning or replacing credentials',async()=>{
 const now=1900000000000,pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicJwk=pair.publicKey.export({format:'jwk'});let saved=null,setupCalls=0,ackCalls=0;
 const options={store:{read:async()=>structuredClone(saved),write:async value=>{saved=structuredClone(value);}},config:{origin:'https://service.invalid',issuers:{fixture:publicJwk}},appVersion:'fixture',now:()=>now,localLicense:async()=>({deviceId:'AKD-SYNTHETIC',status:{valid:true}}),installLicense:async()=>({alreadyInstalled:true}),setupLocalAccount:async candidate=>{setupCalls++;assert.deepEqual(candidate,input);if(setupCalls===1)throw Error('Lost setup reply');return{ready:true,created:false,preserved:true};}};
 let client=new DesktopAccessClient(options);await client.initialize();const requestId=randomUUID(),payload={applicationId:'mr.alkarna.desktop',installationId:saved.installationId,keyFingerprint:fingerprint(saved.publicJwk),requestId,purpose:'desktop-request-approval',requestPurpose:'activation',deviceCode:'AKD-SYNTHETIC',licenseDocumentHash:input.licenseDocumentHash,issuedAt:now,expiresAt:now+60000},signed={schema:'contatools-desktop-decision',version:1,kid:'fixture',payload},grant={...signed,signature:sign('sha256',Buffer.from(canonical(signed)),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};
 await client.persist({request:{requestId,identifier:input.identifier,code:input.code,purpose:'activation',stage:'approved',deviceCode:'AKD-SYNTHETIC',activation:document,grant}});client.call=async()=>{ackCalls++;return{accepted:true};};
 await assert.rejects(client.acceptActivation(),/Lost setup reply/);assert.equal(saved.request.stage,'accepted-local');assert.equal(saved.request.acceptedGrantHash,hash(grant));assert.equal(ackCalls,0);const identity=saved.installationId;
 client=new DesktopAccessClient(options);client.call=async operation=>{assert.equal(operation,'request.accept');ackCalls++;return{accepted:true};};const answer=await client.acceptActivation();assert.equal(saved.request.stage,'linked');assert.equal(saved.installationId,identity);assert.equal(setupCalls,2);assert.equal(ackCalls,1);assert.equal(JSON.stringify(answer).includes(input.code),false);assert.equal(JSON.stringify(await client.view()).includes(input.code),false);
});
