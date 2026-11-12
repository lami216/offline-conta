import {createHash,randomUUID} from "node:crypto";
import {CAPABILITIES,hashPassword,normalizeUsername,verifyPasswordHash} from "./auth.ts";
import type {LicenseStatus} from "./license.ts";
import type {SqliteDatabase} from "./sqlite.ts";

type SetupResult={ready:boolean;created:boolean;preserved:boolean;reason?:string};
const untouchedTables=["products","product_categories","expense_categories","parties","documents","stock_movements","financial_movements","recurring_expenses","account_transfers","app_settings","audit_events","counters","command_receipts","import_runs","import_mappings","import_safety_backups","restore_snapshots","legacy_import_runs","product_stocks","document_lines"];
// These are the existing sqlite.ts seed() business fields; only createdAt varies.
const warehouseDefaults:Record<string,Record<string,unknown>>={"wh-main":{name:"المخزن الرئيسي",isSalesDefault:false},"wh-boutique":{name:"البوتيك",isSalesDefault:true}};
const accountDefaults:Record<string,Record<string,unknown>>={};
for(const[code,name,color,icon]of [["cash","نقدي","#16835f","banknote"],["bankily","بنكيلي","#1677c8","wallet"],["masrvi","مصرفي","#6d55c7","building"],["sedad","السداد","#d07a20","landmark"],["bimbank","بيم","#c14666","card"]])accountDefaults[`account-${code}`]={id:`account-${code}`,code,name,color,icon,isActive:true,balance:0,balanceInitialized:true};
function canonicalSeed(row:{record_key:string;data_json:string},defaults:Record<string,Record<string,unknown>>){
 if(!Object.hasOwn(defaults,row.record_key))return false;
 const value=JSON.parse(row.data_json) as Record<string,unknown>,actual={...value};delete actual.createdAt;
 const expected:Record<string,unknown>={...defaults[row.record_key],_id:row.record_key};
 return Object.keys(actual).sort().join("|")===Object.keys(expected).sort().join("|")&&Object.keys(expected).every(key=>actual[key]===expected[key]);
}

/** Set up only a fresh local store after a verified, installed phone activation. */
export async function prepareRemoteLocalAccount(db:SqliteDatabase,input:{identifier:string;code:string;licenseDocumentHash:string},license:LicenseStatus,installedDocument:string|null):Promise<SetupResult>{
 if(!license.valid||!installedDocument||!/^[a-f0-9]{64}$/.test(input.licenseDocumentHash)||createHash("sha256").update(installedDocument).digest("hex")!==input.licenseDocumentHash)throw Error("LOCAL_LICENSE_REQUIRED");
 const identifier=normalizeUsername(input.identifier),code=input.code;
 if(!/^[234][0-9]{7}$/.test(identifier)||typeof code!=="string"||code.length<8||code.length>256)throw Error("INVALID_CREDENTIALS");
 return db.transaction(async()=>{
  const users=db.native.prepare("SELECT data_json FROM users").all() as Array<{data_json:string}>;
  if(users.length){
   const existing=users.map(row=>JSON.parse(row.data_json)).find(user=>user.usernameNormalized===identifier&&user.isActive===true);
   return{ready:!!existing&&verifyPasswordHash(code,String(existing.passwordHash??"")),created:false,preserved:true,reason:"EXISTING_LOCAL_ACCOUNTS"};
  }
  // A store with no users may still contain old accounting. Never claim it.
  const hasBusinessData=untouchedTables.some(table=>(db.native.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as {count:number}).count!==0);
  const warehouses=db.native.prepare("SELECT record_key,data_json FROM warehouses").all() as Array<{record_key:string;data_json:string}>;
  const accounts=db.native.prepare("SELECT record_key,data_json FROM payment_accounts").all() as Array<{record_key:string;data_json:string}>;
  const blankSeeds=warehouses.length===0&&accounts.length===0,unchangedSeeds=warehouses.length===2&&accounts.length===5&&warehouses.every(row=>canonicalSeed(row,warehouseDefaults))&&accounts.every(row=>canonicalSeed(row,accountDefaults));
  const knownTables=new Set([...untouchedTables,"warehouses","payment_accounts","users","schema_migrations"]),unknownTables=(db.native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all() as Array<{name:string}>).some(row=>!knownTables.has(row.name));
  if(hasBusinessData||unknownTables||!blankSeeds&&!unchangedSeeds)return{ready:false,created:false,preserved:true,reason:"EXISTING_LOCAL_DATA"};
  const id=randomUUID(),now=new Date().toISOString(),user={_id:id,id,username:identifier,usernameNormalized:identifier,name:license.license.customerName||identifier,passwordHash:hashPassword(code),isActive:true,permissions:[...CAPABILITIES],owner:false,createdAt:now,updatedAt:now};
  db.native.prepare("INSERT INTO users(record_key,data_json) VALUES(?,?)").run(id,JSON.stringify(user));
  return{ready:true,created:true,preserved:false};
 });
}
