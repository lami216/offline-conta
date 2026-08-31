/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { hashPassword } from "./password.ts";

export type DbDocument = Record<string, any>;
export type SqliteSession = Record<string, never>;

const tableNames: Record<string, string> = {
  products: "products", warehouses: "warehouses", parties: "parties", paymentAccounts: "payment_accounts",
  documents: "documents", stockMovements: "stock_movements", financialMovements: "financial_movements",
  recurringExpenses: "recurring_expenses", accountTransfers: "account_transfers", appSettings: "app_settings",
  auditEvents: "audit_events", counters: "counters", commandReceipts: "command_receipts", users: "users",
  importRuns: "import_runs", importMappings: "import_mappings", importSafetyBackups: "import_safety_backups",
  restoreSnapshots: "restore_snapshots", legacyImportRuns: "legacy_import_runs",
};
let connection: Database.Database | undefined;

const encode = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item);
const decode = (value: string) => JSON.parse(value) as DbDocument;
const get = (object: any, path: string) => path.split(".").reduce((value, key) => Array.isArray(value) ? value.map(item => item?.[key]) : value?.[key], object);
const scalar = (value: any) => Array.isArray(value) ? value.flat(Infinity) : [value];
const equal = (a: any, b: any) => a instanceof Date ? a.toISOString() === b : b instanceof Date ? b.toISOString() === a : a === b;
function matchesValue(value: any, expected: any): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
    return Object.entries(expected).every(([op, wanted]) => {
      const values = scalar(value);
      if (op === "$in") return values.some(v => (wanted as any[]).some(x => equal(v, x)));
      if (op === "$ne") return values.every(v => !equal(v, wanted));
      if (op === "$gt") return values.some(v => v > wanted!); if (op === "$gte") return values.some(v => v >= wanted!);
      if (op === "$lt") return values.some(v => v < wanted!); if (op === "$lte") return values.some(v => v <= wanted!);
      if (op === "$exists") return (value !== undefined) === wanted;
      if (op === "$type") return values.some(v => wanted === "number" ? typeof v === "number" : wanted === "string" ? typeof v === "string" : true);
      if (op === "$regex") { const flags = String((expected as any).$options ?? ""); return values.some(v => new RegExp(wanted as any, flags).test(String(v ?? ""))); }
      if (op === "$options") return true;
      return matchesValue(get(value, op), wanted);
    });
  }
  return scalar(value).some(v => equal(v, expected));
}
function matches(row: DbDocument, query: DbDocument = {}): boolean {
  return Object.entries(query).every(([key, expected]) => key === "$or" ? (expected as DbDocument[]).some(q => matches(row, q)) : key === "$and" ? (expected as DbDocument[]).every(q => matches(row, q)) : matchesValue(get(row, key), expected));
}
const setPath = (row: DbDocument, path: string, value: any) => { const keys=path.split("."); let at=row; for(const key of keys.slice(0,-1)) at=at[key]??={}; at[keys.at(-1)!]=value; };
function applyUpdate(row: DbDocument, update: DbDocument, inserted=false) {
  if (update.$set) for (const [key,value] of Object.entries(update.$set)) setPath(row,key,value);
  if (update.$inc) for (const [key,value] of Object.entries(update.$inc)) setPath(row,key,Number(get(row,key)??0)+Number(value));
  if (update.$max) for (const [key,value] of Object.entries(update.$max)) if(get(row,key)===undefined||get(row,key)<(value as any))setPath(row,key,value);
  if (inserted && update.$setOnInsert) for (const [key,value] of Object.entries(update.$setOnInsert)) setPath(row,key,value);
  return row;
}

class Cursor {
  constructor(private rows: DbDocument[]) {}
  sort(spec: DbDocument){const entries=Object.entries(spec);this.rows.sort((a,b)=>{for(const[k,d]of entries){const x=get(a,k),y=get(b,k);if(x===y)continue;return(x<y?-1:1)*Number(d)}return 0});return this}
  limit(n:number){this.rows=this.rows.slice(0,n);return this} skip(n:number){this.rows=this.rows.slice(n);return this}
  project(spec:DbDocument){this.rows=this.rows.map(row=>Object.fromEntries(Object.entries(spec).filter(([,v])=>v).map(([k])=>[k,get(row,k)])));return this}
  toArray(){return Promise.resolve(this.rows.map(row=>structuredClone(row)))}
  async next(){return (await this.toArray())[0]}
}
class Collection<T extends DbDocument=DbDocument> {
  constructor(private db: Database.Database, private table:string){}
  private all(){return (this.db.prepare(`SELECT data_json FROM ${this.table}`).all() as {data_json:string}[]).map(x=>decode(x.data_json))}
  private key(row:DbDocument){return String(row._id??row.id??row.key??crypto.randomUUID())}
  private save(row:DbDocument,key?:string){const id=key??this.key(row);if(row._id===undefined)row._id=id;this.db.prepare(`INSERT INTO ${this.table}(record_key,data_json) VALUES(?,?) ON CONFLICT(record_key) DO UPDATE SET data_json=excluded.data_json`).run(id,encode(row));return id}
  find(query:DbDocument={},options?:any){let rows=this.all().filter(row=>matches(row,query));if(options?.projection)rows=new Cursor(rows).project(options.projection) as any;return rows instanceof Cursor?rows:new Cursor(rows)}
  async findOne(query:DbDocument={},options?:any){let rows:DbDocument[]=this.all().filter(row=>matches(row,query));if(options?.sort)rows=await new Cursor(rows).sort(options.sort).toArray();let row=rows[0];if(row&&options?.projection)row=(await new Cursor([row]).project(options.projection).toArray())[0];return row as T|undefined}
  async insertOne(document:T,_options?:any){const row=structuredClone(document);const key=this.key(row);try{this.db.prepare(`INSERT INTO ${this.table}(record_key,data_json) VALUES(?,?)`).run(key,encode({...row,_id:row._id??key}));return{insertedId:key}}catch(error){(error as any).code=11000;throw error}}
  async insertMany(documents:T[],_options?:any){for(const document of documents)await this.insertOne(document);return{insertedCount:documents.length}}
  async updateOne(filter:DbDocument,update:DbDocument,options?:any){const found=this.all().find(row=>matches(row,filter));if(found){this.save(applyUpdate(found,update),this.key(found));return{matchedCount:1,modifiedCount:1}}if(options?.upsert){const base=Object.fromEntries(Object.entries(filter).filter(([k,v])=>!k.startsWith("$")&&!(v&&typeof v==="object")));const row=applyUpdate(base,update,true);this.save(row);return{matchedCount:0,upsertedCount:1}}return{matchedCount:0,modifiedCount:0}}
  async updateMany(filter:DbDocument,update:DbDocument,_options?:any){let n=0;for(const row of this.all().filter(x=>matches(x,filter))){this.save(applyUpdate(row,update),this.key(row));n++}return{matchedCount:n,modifiedCount:n}}
  async findOneAndUpdate(filter:DbDocument,update:DbDocument,options?:any){await this.updateOne(filter,update,options);return this.findOne(filter)}
  async deleteOne(filter:DbDocument,_options?:any){const row=this.all().find(x=>matches(x,filter));if(!row)return{deletedCount:0};this.db.prepare(`DELETE FROM ${this.table} WHERE record_key=?`).run(this.key(row));return{deletedCount:1}}
  async deleteMany(filter:DbDocument,_options?:any){let n=0;for(const row of this.all().filter(x=>matches(x,filter))){this.db.prepare(`DELETE FROM ${this.table} WHERE record_key=?`).run(this.key(row));n++}return{deletedCount:n}}
  countDocuments(query:DbDocument={}){return Promise.resolve(this.all().filter(x=>matches(x,query)).length)}
  createIndex(..._args:any[]){return Promise.resolve("sqlite-schema-index")}
  async bulkWrite(ops:any[],_options?:any){for(const op of ops)if(op.updateOne)await this.updateOne(op.updateOne.filter,op.updateOne.update,op.updateOne)}
  aggregate(pipeline:DbDocument[]){let rows=this.all();for(const stage of pipeline){if(stage.$match)rows=rows.filter(r=>matches(r,stage.$match));else if(stage.$sort)rows=(new Cursor(rows).sort(stage.$sort) as any).rows;else if(stage.$unwind){const path=String(stage.$unwind).replace(/^\$/,'');rows=rows.flatMap(r=>(get(r,path)??[]).map((v:any)=>{const c=structuredClone(r);setPath(c,path,v);return c}))}else if(stage.$group){const groups=new Map<string,DbDocument>();for(const row of rows){const id=stage.$group._id===null?null:get(row,String(stage.$group._id).replace(/^\$/,''));const key=encode(id),out=groups.get(key)??{_id:id};for(const[field,expr]of Object.entries(stage.$group).slice(1)){const e=expr as any;if(e.$sum!==undefined){let value=e.$sum;if(typeof value==='string'&&value.startsWith('$'))value=get(row,value.slice(1));else if(value?.$cond){const[c,t,f]=value.$cond;value=matchesValue(get(row,String(c.$eq?.[0]??'').replace(/^\$/,'')),c.$eq?.[1])?(typeof t==='string'?get(row,t.slice(1)):t):(typeof f==='string'?get(row,f.slice(1)):f)}out[field]=Number(out[field]??0)+Number(value??0)}else if(e.$first!==undefined&&out[field]===undefined)out[field]=get(row,String(e.$first).replace(/^\$/,''));}groups.set(key,out)}rows=[...groups.values()]}}return new Cursor(rows)}
}

export class SqliteDatabase {
  constructor(readonly native:Database.Database){}
  collection<T extends DbDocument=DbDocument>(name:string){const table=tableNames[name];if(!table)throw new Error(`Unknown data set: ${name}`);return new Collection<T>(this.native,table)}
  command(_command?:any){return Promise.resolve({ok:1})}
  async transaction<T>(work:(session:SqliteSession)=>Promise<T>){this.native.exec("BEGIN IMMEDIATE");try{const result=await work({});this.native.exec("COMMIT");return result}catch(error){this.native.exec("ROLLBACK");throw error}}
}

export function databasePath(){return process.env.ALKARNA_DATABASE_PATH||join(process.env.ALKARNA_USER_DATA||join(process.cwd(),".dev-data"),"data","alkarna.sqlite")}
export function initializeDatabase(){if(connection)return new SqliteDatabase(connection);const file=databasePath();mkdirSync(dirname(file),{recursive:true});connection=new Database(file);connection.pragma("foreign_keys = ON");connection.pragma("journal_mode = WAL");connection.pragma("synchronous = FULL");connection.pragma("busy_timeout = 5000");ensureDatabaseSchema(connection);return new SqliteDatabase(connection)}
export function getDatabase(){return initializeDatabase()}
export function closeDatabase(){connection?.close();connection=undefined}
export function ensureDatabaseSchema(input:Database.Database|SqliteDatabase){const db=input instanceof SqliteDatabase?input.native:input;db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);`);const version=(db.prepare("SELECT max(version) version FROM schema_migrations").get() as any).version??0;if(version<1){db.transaction(()=>{for(const table of Object.values(tableNames))db.exec(`CREATE TABLE ${table}(record_key TEXT PRIMARY KEY,data_json TEXT NOT NULL)`);db.exec(`CREATE TABLE product_stocks(product_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,quantity REAL NOT NULL,PRIMARY KEY(product_id,warehouse_id));CREATE TABLE document_lines(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,product_id TEXT,quantity REAL,unit_price INTEGER,line_total INTEGER);CREATE UNIQUE INDEX products_barcode_nonempty ON products(json_extract(data_json,'$.barcode')) WHERE json_extract(data_json,'$.barcode') IS NOT NULL AND json_extract(data_json,'$.barcode')<>'';`);db.prepare("INSERT INTO schema_migrations VALUES(1,?)").run(new Date().toISOString())})();seed(db)}db.prepare("DELETE FROM command_receipts WHERE json_extract(data_json,'$.status')='committed' AND datetime(json_extract(data_json,'$.createdAt')) < datetime('now','-7 days')").run();const check=db.pragma("quick_check") as any[];if(check[0]?.quick_check!=="ok")throw new Error("SQLite quick_check failed")}
function seed(db:Database.Database){const now=new Date().toISOString(),put=(table:string,key:string,data:any)=>db.prepare(`INSERT OR IGNORE INTO ${table}(record_key,data_json) VALUES(?,?)`).run(key,encode({...data,_id:key}));put("warehouses","wh-main",{name:"المخزن الرئيسي",isSalesDefault:false,createdAt:now});put("warehouses","wh-boutique",{name:"البوتيك",isSalesDefault:true,createdAt:now});for(const[code,name,color,icon]of [["cash","نقدي","#16835f","banknote"],["bankily","بنكيلي","#1677c8","wallet"],["masrvi","مصرفي","#6d55c7","building"],["sedad","السداد","#d07a20","landmark"],["bimbank","بيم","#c14666","card"]])put("payment_accounts",`account-${code}`,{id:`account-${code}`,code,name,color,icon,isActive:true,balance:0,balanceInitialized:true,createdAt:now});put("users","owner",{id:"owner",username:"المالك",usernameNormalized:"المالك",name:"المالك",passwordHash:hashPassword("12345678"),isActive:true,owner:true,createdAt:now})}
