import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sqliteHarness} from './sqlite-harness.mjs';
import {createNativeBackup,parseAndValidateBackup,restoreNativeBackup} from '../lib/backup.ts';
import {CAPABILITIES,createSession,hashPassword,SESSION_COOKIE} from '../lib/auth.ts';
import {POST as preview} from '../app/api/settings/restore/preview/route.ts';
import {POST as restore} from '../app/api/settings/restore/route.ts';
import {POST as login} from '../app/api/auth/login/route.ts';
import {execute} from '../app/api/command/route.ts';
import {buildReport,parseReportFilters} from '../lib/reports.ts';
import {createHash} from 'node:crypto';

const origin='http://127.0.0.1:3219',password='synthetic-desktop-only-4826';
function request(route,body,{user='desktop-owner',headers={}}={}){return new Request(origin+route,{method:'POST',headers:{origin,host:'127.0.0.1:3219','content-type':'application/json',...(user?{cookie:`${SESSION_COOKIE}=${createSession({principalType:'user',userId:user})}`}:{ }),...headers},body:JSON.stringify(body)});}
async function setup(t){const previous=process.env.ALKARNA_USER_DATA,h=await sqliteHarness();process.env.ALKARNA_USER_DATA=h.directory;t.after(async()=>{await h.close();if(previous===undefined)delete process.env.ALKARNA_USER_DATA;else process.env.ALKARNA_USER_DATA=previous;});const user={id:'desktop-owner',username:'desktop-owner',usernameNormalized:'desktop-owner',name:'Synthetic Desktop Owner',passwordHash:hashPassword(password),isActive:true,permissions:[...CAPABILITIES]};await h.db.collection('users').insertOne(user);return {...h,user:await h.db.collection('users').findOne({id:user.id})};}
const fixtureText=await readFile(new URL('./fixtures/mobile-business-backup-v39.json',import.meta.url),'utf8'),fixtureProof=JSON.parse(await readFile(new URL('./fixtures/mobile-business-backup-v39-source.json',import.meta.url),'utf8'));
assert.equal(createHash('sha256').update(fixtureText).digest('hex'),fixtureProof.fixtureSha256);
async function fixture(){return JSON.parse(fixtureText);}
const canonicalTotals=c=>({accounts:c.paymentAccounts.map(a=>[a.id,a.balance]).sort(),parties:c.parties.map(p=>[p.id,p.receivable,p.payable]).sort(),stock:c.products.map(p=>[p.id,p.stocks]).sort(),employees:c.employees.map(e=>[e.id,e.balance,e.agreements]).sort()});

test('current39 business wrapper uses the actual Desktop parser and read-only authenticated preview',async t=>{
 const h=await setup(t),wrapper=await fixture(),before=await createNativeBackup(h.db),parsed=parseAndValidateBackup(JSON.stringify(wrapper));
 assert.deepEqual(parsed.mobileImport,{sourceFormat:'alkarna-mobile-business-backup',schemaVersion:1});assert.deepEqual(parsed.collections.users,[]);
 const result=await preview(request('/api/settings/restore/preview',wrapper));assert.equal(result.status,200,await result.clone().text());const body=await result.json();assert.equal(body.preservesDesktopUsers,true);assert.equal(body.sourceFormat,'alkarna-mobile-business-backup');assert.deepEqual(body.counts,parsed.counts);assert(!JSON.stringify(body).includes('NEVER-EXPORT'));
 assert.deepEqual((await createNativeBackup(h.db)).collections,before.collections);
});
test('actual restore keeps Desktop usernames and password hashes, license files and recovery copy then forces a fresh real login',async t=>{
 const h=await setup(t),config=path.join(h.directory,'config');await mkdir(config,{recursive:true});const license=path.join(config,'license.alkarna-license'),ledger=path.join(config,'license-ledger-sentinel.json');await writeFile(license,'SYNTHETIC-EXISTING-LICENSE-BYTES');await writeFile(ledger,'SYNTHETIC-EXISTING-LICENSE-LEDGER');
 await h.db.collection('products').insertOne({id:'prior-product',sku:'prior',name:'Prior data',stocks:{}});const before=await createNativeBackup(h.db),response=await restore(request('/api/settings/restore',await fixture()));assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).sessionReset,true);assert.match(response.headers.get('set-cookie'),/conta_session=;.*Max-Age=0/);assert.deepEqual(await h.db.collection('users').find().toArray(),[h.user]);assert.equal(await readFile(license,'utf8'),'SYNTHETIC-EXISTING-LICENSE-BYTES');assert.equal(await readFile(ledger,'utf8'),'SYNTHETIC-EXISTING-LICENSE-LEDGER');
 const recovery=await h.db.collection('restoreSnapshots').findOne({});assert.deepEqual(parseAndValidateBackup(recovery.backup).collections,before.collections);
 const body=new FormData();body.set('username',h.user.username);body.set('password',password);const loggedIn=await login(new Request(origin+'/api/auth/login',{method:'POST',headers:{origin,host:'127.0.0.1:3219','x-alkarna-login-ui':'1'},body}));assert.equal(loggedIn.status,200,await loggedIn.clone().text());assert.equal((await loggedIn.json()).ok,true);
});
test('business transport preserves authorization, same-origin gates and atomic rejection before recovery copy',async t=>{
 const h=await setup(t),wrapper=await fixture(),before=await createNativeBackup(h.db);await h.db.collection('users').insertOne({id:'reader',username:'reader',name:'Reader',isActive:true,permissions:['products.view']});const stable=await createNativeBackup(h.db);
 for(const handler of [preview,restore]){assert.equal((await handler(request('/api/settings/restore',wrapper,{user:null}))).status,401);assert.equal((await handler(request('/api/settings/restore',wrapper,{user:'reader'}))).status,403);assert.equal((await handler(request('/api/settings/restore',wrapper,{headers:{origin:'https://foreign.invalid'}}))).status,403);}
 const bad=structuredClone(wrapper);bad.backup.collections.documents.find(d=>d.kind==='sale').lines[0].productId='missing-product';assert.equal((await restore(request('/api/settings/restore',bad))).status,400);assert.deepEqual((await createNativeBackup(h.db)).collections,stable.collections);assert.equal(await h.db.collection('restoreSnapshots').countDocuments(),0);assert.equal(before.collections.users[0].passwordHash,h.user.passwordHash);
});
test('native backups still cannot forge the credentials-preserving import tag or smuggle source users',async t=>{
 const h=await setup(t),native=await createNativeBackup(h.db);native.mobileImport={sourceFormat:'alkarna-mobile-business-backup',schemaVersion:1};assert.equal(parseAndValidateBackup(JSON.stringify(native)).mobileImport,undefined);
 const bad=await fixture();bad.backup.collections.users=[{id:'foreign-owner',username:'foreign',passwordHash:'forbidden'}];assert.throws(()=>parseAndValidateBackup(JSON.stringify(bad)),/تبادل بيانات الهاتف/);
 const before=await createNativeBackup(h.db);assert.equal((await restore(request('/api/settings/restore',bad))).status,400);assert.deepEqual((await createNativeBackup(h.db)).collections,before.collections);
});
test('existing Desktop commands operate on canonical current effects and keep signed banks and exact invoices intact',async t=>{
 const h=await setup(t),wrapper=await fixture(),parsed=parseAndValidateBackup(JSON.stringify(wrapper));await h.db.transaction(session=>restoreNativeBackup(h.db,parsed,session));
 const before=await createNativeBackup(h.db),expense=before.collections.documents.find(d=>d.kind==='expense'),account=before.collections.paymentAccounts.find(a=>a.id===expense.paymentMethod),bank=before.collections.paymentAccounts[1],sale=before.collections.documents.find(d=>d.mobileSource?.id===117);
 await h.db.transaction(session=>execute(h.db,session,{type:'expense.void',documentId:expense.id,expectedRevision:expense.revision}));const after=await createNativeBackup(h.db);assert.equal(after.collections.documents.find(d=>d.id===expense.id).status,'voided');assert.equal(after.collections.paymentAccounts.find(a=>a.id===account.id).balance,account.balance+expense.total);assert.equal(after.collections.paymentAccounts.find(a=>a.id===bank.id).balance,-5);assert.deepEqual(after.collections.documents.find(d=>d.id===sale.id),sale);
 assert(after.collections.financialMovements.some(m=>m.documentId===expense.id&&m.isReversal===true));assert(after.collections.financialMovements.some(m=>m.documentId===expense.id&&m.status==='reversed'));parseAndValidateBackup(JSON.stringify(after));
});
test('actual SQLite re-export and native re-import keep canonical identities, payroll and report summaries',async t=>{
 const h=await setup(t),wrapper=await fixture();await h.db.transaction(session=>restoreNativeBackup(h.db,parseAndValidateBackup(JSON.stringify(wrapper)),session));
 const first=await createNativeBackup(h.db),filters=type=>parseReportFilters(new URL(`http://local/?type=${type}&allTime=true&unpaged=true`)),reports={};for(const type of ['overview','sales','purchases','expenses','financial','debts'])reports[type]=(await buildReport(h.db,filters(type))).summary;
 const again=parseAndValidateBackup(JSON.stringify(first));assert.deepEqual(canonicalTotals(again.collections),canonicalTotals(first.collections));await h.db.transaction(session=>restoreNativeBackup(h.db,again,session));const second=await createNativeBackup(h.db);assert.deepEqual(canonicalTotals(second.collections),canonicalTotals(first.collections));for(const type of Object.keys(reports))assert.deepEqual((await buildReport(h.db,filters(type))).summary,reports[type],type);assert.deepEqual(await h.db.collection('users').find().toArray(),[h.user]);
});
