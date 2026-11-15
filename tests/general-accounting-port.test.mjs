import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

let directory,sqlite,db,POST,auth;
const environment=new Map(),origin='http://127.0.0.1:3241';
const post=async(body,{user,key=randomUUID()}={})=>{
 const response=await POST(new Request(origin+'/api/command',{method:'POST',headers:{Origin:origin,Host:'127.0.0.1:3241','Content-Type':'application/json','Idempotency-Key':key,...(user?{Cookie:`conta_session=${auth.createSession({principalType:'user',userId:user})}`}:{})},body:JSON.stringify(body)}));
 return{status:response.status,body:await response.json()};
};
const ok=async(body,options)=>{const result=await post(body,options);assert.equal(result.status,200,JSON.stringify(result));return result.body.id;};
const state=()=>Promise.all(['parties','employees','products','documents','paymentAccounts','financialMovements','stockMovements','auditEvents','commandReceipts','counters'].map(name=>db.collection(name).find().toArray()));
const cash=async()=>(await db.collection('paymentAccounts').findOne({id:'cash'})).balance;
const party=id=>db.collection('parties').findOne({id});
const doc=id=>db.collection('documents').findOne({id});

before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'alkarna-general-accounting-port-'));
 for(const[key,value]of Object.entries({NODE_ENV:'test',ALKARNA_DESKTOP:'1',ALKARNA_USER_DATA:join(directory,'profile'),ALKARNA_DATABASE_PATH:join(directory,'database.sqlite'),ALKARNA_LICENSE_STATE_PATH:join(directory,'license-state.json'),ALKARNA_LICENSE_DISABLE_REGISTRY:'1',ALKARNA_TEST_LICENSE_BYPASS:'1'})){environment.set(key,process.env[key]);process.env[key]=value;}
 sqlite=await import('../lib/sqlite.ts');sqlite.closeDatabase();db=sqlite.initializeDatabase();({POST}=await import('../app/api/command/route.ts'));auth=await import('../lib/auth.ts');
});
after(async()=>{sqlite?.closeDatabase();for(const[key,value]of environment){if(value===undefined)delete process.env[key];else process.env[key]=value;}if(directory)await rm(directory,{recursive:true,force:true});});
beforeEach(async()=>{
 await db.dropDatabase();await db.collection('warehouses').insertOne({_id:'w',name:'Synthetic warehouse',isSalesDefault:true});
 await db.collection('paymentAccounts').insertOne({id:'cash',code:'cash',name:'Synthetic cash',isActive:true,balance:10000,openingBalance:10000});
 await db.collection('products').insertOne({id:'p',sku:'1',name:'Synthetic ordinary product',stocks:{w:0},pieceCost:0,piecePrice:150});
 await db.collection('users').insertMany([
  {id:'creator',username:'creator',name:'Synthetic creator',isActive:true,permissions:['customers.create']},
  {id:'opening',username:'opening',name:'Synthetic opening manager',isActive:true,permissions:['customers.create','party.opening.manage']},
 ]);
});

test('quick party creation remains zero balance; full creation needs an additional opening capability before writing anything',async()=>{
 const quick=await ok({type:'party.create',partyType:'customer',name:'Synthetic quick name'},{user:'creator'});assert.equal((await party(quick)).net,0);assert.equal(await db.collection('documents').countDocuments({partyId:quick}),0);
 const before=await state(),body={type:'party.create',partyType:'customer',name:'Synthetic full name',opening:{direction:'receivable',amount:1000}};
 assert.equal((await post(body,{user:'creator'})).status,403);assert.deepEqual(await state(),before);
 const key=randomUUID(),created=await post(body,{user:'opening',key});assert.equal(created.status,200,JSON.stringify(created));assert.equal((await party(created.body.id)).net,1000);
 const stable=await state();assert.deepEqual(await post(body,{user:'opening',key}),created);assert.deepEqual(await state(),stable);assert.equal(await db.collection('documents').countDocuments({kind:'party-opening'}),1);assert.equal(await cash(),10000);
});

test('nested opening failure rolls back its new party and receipt and permits a corrected same-key retry',async()=>{
 const key=randomUUID(),body={type:'party.create',partyType:'customer',name:'Synthetic atomic creation',phone:'00000001',opening:{direction:'receivable',amount:0}},before=await state();
 assert.equal((await post(body,{user:'opening',key})).status,400);assert.deepEqual(await state(),before);
 const id=await ok({...body,opening:{direction:'receivable',amount:10}},{user:'opening',key});assert.equal((await party(id)).net,10);assert.equal(await db.collection('documents').countDocuments({kind:'party-opening',partyId:id}),1);
});

test('ordinary old and exact invoices coexist with opening-debt changes without changing snapshots, stock policy or receipt semantics',async()=>{
 const partyId=await ok({type:'party.create',partyType:'customer',name:'Synthetic account',opening:{direction:'receivable',amount:1000}}),opening=await db.collection('documents').findOne({kind:'party-opening',partyId});
 const purchase=await ok({type:'purchase.post',warehouseId:'w',paymentMethod:'cash',lines:[{productId:'p',quantity:3,unitPrice:100.2}]});assert.equal((await doc(purchase)).total,301);assert.equal((await doc(purchase)).lines[0].lineTotalMode,undefined);
 const sale=await ok({type:'sale.post',partyId,warehouseId:'w',paymentMethod:'cash',paidAmount:400.5,lines:[{productId:'p',quantity:3,piecePrice:133.5,lineTotal:400.5}]});
 const sold=await doc(sale);assert.equal(sold.total,400.5);assert.equal(sold.lines[0].costAtSale,100.2);assert.equal((await party(partyId)).net,1000);assert.equal((await db.collection('products').findOne({id:'p'})).stocks.w,0);
 await ok({type:'sale.update',documentId:sale,partyId,warehouseId:'w',paymentMethod:'cash',lines:[{productId:'p',quantity:3,piecePrice:133.5}]});assert.deepEqual((await doc(sale)).lines,sold.lines);
 await ok({type:'party-cash.post',partyId,direction:'receive',amount:400,paymentMethod:'cash'});assert.equal((await party(partyId)).net,600);
 await ok({type:'party-opening.update',documentId:opening.id,expectedRevision:0,direction:'receivable',amount:800});assert.equal((await party(partyId)).net,400);
 const beforeVoidCash=await cash(),beforeVoidStock=(await db.collection('products').findOne({id:'p'})).stocks.w;
 await ok({type:'party-opening.void',documentId:opening.id,expectedRevision:1});assert.equal((await party(partyId)).net,-400);assert.equal(await cash(),beforeVoidCash);assert.equal((await db.collection('products').findOne({id:'p'})).stocks.w,beforeVoidStock);assert.deepEqual((await doc(sale)).lines,sold.lines);
 await ok({type:'sale.void',documentId:sale});assert.equal((await db.collection('products').findOne({id:'p'})).stocks.w,3);
 await ok({type:'purchase.void',documentId:purchase});assert.equal((await db.collection('products').findOne({id:'p'})).stocks.w,0);assert.equal(await cash(),10400);
});
