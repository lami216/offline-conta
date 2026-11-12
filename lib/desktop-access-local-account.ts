import {createHash,randomUUID} from "node:crypto";
import {CAPABILITIES,hashPassword,normalizeUsername,verifyPasswordHash} from "./auth.ts";
import type {LicenseStatus} from "./license.ts";
import type {SqliteDatabase} from "./sqlite.ts";

type SetupResult={ready:boolean;created:boolean;preserved:boolean;reason?:string};
const untouchedTables=["products","product_categories","expense_categories","parties","documents","stock_movements","financial_movements","recurring_expenses","account_transfers","app_settings","audit_events","counters","command_receipts","import_runs","import_mappings","import_safety_backups","restore_snapshots","legacy_import_runs"];

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
  const expectedWarehouses=new Set(["wh-main","wh-boutique"]),expectedAccounts=new Set(["account-cash","account-bankily","account-masrvi","account-sedad","account-bimbank"]);
  const changedDefaults=warehouses.some(row=>!expectedWarehouses.has(row.record_key))||accounts.some(row=>!expectedAccounts.has(row.record_key)||Number(JSON.parse(row.data_json).balance)!==0);
  if(hasBusinessData||changedDefaults)return{ready:false,created:false,preserved:true,reason:"EXISTING_LOCAL_DATA"};
  const id=randomUUID(),now=new Date().toISOString(),user={_id:id,id,username:identifier,usernameNormalized:identifier,name:license.license.customerName||identifier,passwordHash:hashPassword(code),isActive:true,permissions:[...CAPABILITIES],owner:false,createdAt:now,updatedAt:now};
  db.native.prepare("INSERT INTO users(record_key,data_json) VALUES(?,?)").run(id,JSON.stringify(user));
  return{ready:true,created:true,preserved:false};
 });
}
