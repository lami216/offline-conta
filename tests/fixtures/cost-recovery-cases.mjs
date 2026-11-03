export const recoveryCases=['valid-zero','valid-missing','invalid-negative','invalid-sale','imported-sale','imported-source','voided-source','revised-source','future-source','late-posted-source','tied-sources','invalid-latest-source','generated-decant','untagged-generated','positive-control','reviewed-zero','many-pending'];
export async function seedRecoveryCase(db,name){
 const product={id:'p',sku:'1',name:'Synthetic cost equivalence',pieceCost:999,lastPurchaseCost:999,stocks:{w:3}};
 const source={id:'purchase',number:'PUR-EQUIVALENCE',sequence:1,revision:0,kind:'purchase',status:'posted',occurredAt:'2026-09-01T10:00:00.000Z',total:400,paidTotal:400,dueTotal:0,lines:[{id:'purchase-line',productId:'p',quantity:4,unitPrice:100,lineTotal:400}]};
 const sale={id:'sale',number:'SAL-EQUIVALENCE',sequence:1,revision:0,kind:'sale',status:'posted',occurredAt:'2026-09-10T10:00:00.000Z',businessDate:'2026-09-10',dailySequence:1,total:150,paidTotal:0,dueTotal:150,lines:[{id:'sale-line',productId:'p',quantity:1,unitPrice:150,lineTotal:150,costAtSale:0,grossProfit:150}]};
 const sources=[source],sales=[sale];
 if(name==='valid-missing')Object.assign(sale.lines[0],{costAtSale:null,grossProfit:null});
 if(name==='invalid-negative')sale.lines[0].costAtSale=-1;
 if(name==='invalid-sale')sale.total=151;
 if(name==='imported-sale')sale.legacyKey='synthetic-imported-sale';
 if(name==='imported-source')source.legacyKey='synthetic-imported-source';
 if(name==='voided-source')source.status='voided';
 if(name==='revised-source')source.revision=1;
 if(name==='future-source')source.occurredAt='2026-09-20T10:00:00.000Z';
 if(name==='tied-sources'){delete source.sequence;sources.push({...structuredClone(source),id:'tied-purchase',number:'PUR-TIED'});}
 if(name==='invalid-latest-source')sources.push({...structuredClone(source),id:'newer-purchase',number:'PUR-NEWER',sequence:2,occurredAt:'2026-09-02T10:00:00.000Z',lines:[{...source.lines[0],id:'newer-line',unitPrice:null}]});
 if(name==='generated-decant')product.perfumeForm='decant';
 if(name==='untagged-generated')product.parentProductId='historical-source';
 if(name==='positive-control')Object.assign(sale.lines[0],{costAtSale:70,grossProfit:80});
 if(name==='reviewed-zero')sale.lines[0].saleCostRecovery={action:'confirm-zero'};
 if(name==='many-pending')for(let index=1;index<5;index++)sales.push({...structuredClone(sale),id:'sale-'+index,number:'SAL-'+index,sequence:index+1,dailySequence:index+1,lines:[{...sale.lines[0],id:'sale-line-'+index}]});
 await db.collection('products').insertOne(product);
 await db.collection('documents').insertMany(name==='late-posted-source'?[...sales,...sources]:[...sources,...sales]);
 if(name==='reviewed-zero')await db.collection('auditEvents').insertOne({id:'prior-zero-review',action:'sale-cost-recovery.confirm',version:1,actor:{principalType:'local'},lineIndex:0,lineId:'sale-line',afterDocument:await db.collection('documents').findOne({id:'sale'})});
 return {product,source,sale};
}
