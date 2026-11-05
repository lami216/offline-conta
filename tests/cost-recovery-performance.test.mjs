import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sqliteHarness} from './sqlite-harness.mjs';
import {recoveryCases,seedRecoveryCase} from './fixtures/cost-recovery-cases.mjs';
import {accountingHealth,readSaleCostRecoverySummary,recoverHistoricalSaleCosts,confirmSaleCostRecovery} from '../lib/sale-cost-recovery.ts';
const golden=JSON.parse(readFileSync(new URL('./fixtures/cost-recovery-golden.json',import.meta.url),'utf8'));
const state=db=>Promise.all(['documents','products','auditEvents','appSettings'].map(name=>db.collection(name).find().toArray()));

test('lazy recovery health preserves exact pre-optimization rows, tokens, summaries and pagination',async t=>{
  const h=await sqliteHarness();t.after(()=>h.close());assert.deepEqual(golden.cases.map(row=>row.name),recoveryCases);
  for(const fixture of golden.cases){
    await h.reset();await seedRecoveryCase(h.db,fixture.name);const before=await state(h.db);
    for(const page of fixture.pages)assert.deepEqual(accountingHealth(h.db,page.options),page.result,fixture.name+JSON.stringify(page.options));
    assert.deepEqual(readSaleCostRecoverySummary(h.db),fixture.summary,fixture.name+' summary');
    assert.deepEqual(await state(h.db),before,fixture.name+' read-only health');
  }
});

test('startup and pending-count reads never resolve source history for explicit saved-zero cases',async t=>{
  const h=await sqliteHarness();t.after(()=>h.close());await h.reset();await seedRecoveryCase(h.db,'many-pending');
  const before=await state(h.db),parse=Date.parse;let parses=0;Date.parse=(...args)=>{parses++;return parse(...args)};t.after(()=>{Date.parse=parse});
  assert.equal(recoverHistoricalSaleCosts(h.db).savedZeroReview,5);
  assert.equal(readSaleCostRecoverySummary(h.db).savedZeroReview,5);
  assert.equal(parses,0,'Saved zero requires owner review, so startup/counts need no source chronology work');
  assert.deepEqual(await state(h.db),before,'A no-repair dataset must not gain migration settings or journals');
  const one=accountingHealth(h.db,{page:1,pageSize:1});assert.equal(one.rows.length,1);assert.equal(one.rows[0].suggestedPriorCost,100);
  assert(parses>0&&parses<10,'Only the requested page should resolve source proof');
});

test('owner confirmation resolves only its requested row and leaves all unrelated saved-zero invoices intact',async t=>{
  const h=await sqliteHarness();t.after(()=>h.close());await h.reset();await seedRecoveryCase(h.db,'many-pending');
  const row=accountingHealth(h.db,{page:1,pageSize:1}).rows[0],products=await h.db.collection('products').find().toArray();
  const parse=Date.parse;let parses=0;Date.parse=(...args)=>{parses++;return parse(...args)};t.after(()=>{Date.parse=parse});
  const result=confirmSaleCostRecovery(h.db,{documentId:row.documentId,lineId:row.lineId,expectedRevision:row.revision,reviewToken:row.reviewToken,action:'apply-suggested',reason:'Synthetic single-row review'}, {principalType:'local',name:'Synthetic test owner'});
  assert.equal(result.costAtSale,100);assert(parses>0&&parses<10,'Unrelated rows must not repeat source resolution before one confirmation');
  const sales=await h.db.collection('documents').find({kind:'sale'}).toArray();
  assert.equal(sales.filter(sale=>sale.lines[0].costAtSale===100).length,1);assert.equal(sales.filter(sale=>sale.lines[0].costAtSale===0).length,4);
  assert.deepEqual(await h.db.collection('products').find().toArray(),products);
  assert.equal(readSaleCostRecoverySummary(h.db).savedZeroReview,4);assert.equal(await h.db.collection('auditEvents').countDocuments(),1);
});
