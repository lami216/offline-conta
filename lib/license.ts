import { createHash, webcrypto } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { log } from "./log.ts";
import { LICENSE_ALGORITHM, LICENSE_KEY_ID, PUBLIC_LICENSE_KEYS } from "./license-public-key.ts";

export const MAX_LICENSE_BYTES = 64 * 1024;
export const LICENSE_FILENAME = "license.alkarna-license";
const DEVICE_ERROR = "تعذر استخراج رقم الجهاز. تواصل مع الدعم.";
const execFileAsync = promisify(execFile);

export type LicensePayload = { licenseId:string;storeId:string;customerName:string;storeName:string;deviceId:string;edition:string;type:string;issuedAt:string;notes:string };
export type LicenseDocument = { schema:string;version:number;keyId:string;algorithm:string;payload:LicensePayload;signature:string };
export type LicenseInfo = Pick<LicensePayload,"licenseId"|"storeId"|"customerName"|"storeName"|"deviceId"|"issuedAt">;
export type LicenseStatus = { valid:false;reason?:string } | { valid:true;license:LicenseInfo };

export class LicenseError extends Error { constructor(message:string,public status=400){super(message)} }

export function canonicalLicensePayload(payload:LicensePayload) {
  return JSON.stringify({licenseId:payload.licenseId,storeId:payload.storeId,customerName:payload.customerName,storeName:payload.storeName,deviceId:payload.deviceId,edition:payload.edition,type:payload.type,issuedAt:payload.issuedAt,notes:payload.notes});
}

export function formatDeviceCode(machineGuid:string) {
  const normalized=machineGuid.trim().toLowerCase().replace(/[{}]/g,"");
  if(!normalized)throw new LicenseError(DEVICE_ERROR,500);
  const digest=createHash("sha256").update(`mr.alkarna.desktop|device-v1|${normalized}`,"utf8").digest("hex").slice(0,20).toUpperCase();
  return `AKD-${digest.match(/.{1,4}/g)!.join("-")}`;
}

export async function getDeviceId() {
  if(process.env.NODE_ENV==="test"&&process.env.ALKARNA_TEST_DEVICE_ID){
    const value=process.env.ALKARNA_TEST_DEVICE_ID.trim();
    return /^AKD-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/.test(value)?value:formatDeviceCode(value);
  }
  if(process.platform!=="win32")throw new LicenseError(DEVICE_ERROR,500);
  try{
    const {stdout}=await execFileAsync("reg.exe",["query","HKLM\\SOFTWARE\\Microsoft\\Cryptography","/v","MachineGuid"],{windowsHide:true,timeout:5000});
    const match=stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    if(!match?.[1])throw new Error("MachineGuid was absent");
    return formatDeviceCode(match[1]);
  }catch(error){log("error","license.device.failed",{error});throw new LicenseError(DEVICE_ERROR,500)}
}

export function getLicensePath(){return join(process.env.ALKARNA_USER_DATA??join(process.cwd(),".dev-data"),"config",LICENSE_FILENAME)}
function strictBase64Url(value:string){
  if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw new LicenseError("تعذر التحقق من توقيع الترخيص");
  const bytes=Buffer.from(value,"base64url");
  if(bytes.length!==64||bytes.toString("base64url")!==value)throw new LicenseError("تعذر التحقق من توقيع الترخيص");
  return bytes;
}
function required(value:unknown){return typeof value==="string"&&value.trim().length>0}
function validIsoTimestamp(value:string){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return false;return Number.isFinite(Date.parse(value))}
export function parseLicenseFile(content:string|Uint8Array){
  const bytes=typeof content==="string"?Buffer.byteLength(content):content.byteLength;
  if(bytes>MAX_LICENSE_BYTES)throw new LicenseError("ملف الترخيص أكبر من الحد المسموح",413);
  let value:unknown;try{value=JSON.parse(typeof content==="string"?content:Buffer.from(content).toString("utf8"))}catch{throw new LicenseError("ملف الترخيص غير مدعوم")}
  if(!value||typeof value!=="object"||Array.isArray(value))throw new LicenseError("ملف الترخيص غير مدعوم");
  return value as LicenseDocument;
}

export async function verifyLicenseFile(content:string|Uint8Array,currentDeviceId?:string,keys?:Record<string,JsonWebKey>) {
  currentDeviceId??=await getDeviceId();keys??=PUBLIC_LICENSE_KEYS as unknown as Record<string,JsonWebKey>;
  const doc=parseLicenseFile(content),p=doc.payload;
  if(doc.schema!=="alkarna-license"||doc.version!==1||doc.algorithm!==LICENSE_ALGORITHM||doc.keyId!==LICENSE_KEY_ID||!keys[doc.keyId])throw new LicenseError("ملف الترخيص غير مدعوم");
  if(!p||typeof p!=="object"||![p.licenseId,p.storeId,p.customerName,p.storeName,p.deviceId,p.edition,p.type,p.issuedAt].every(required)||typeof p.notes!=="string"||p.edition!=="desktop"||p.type!=="perpetual"||!validIsoTimestamp(p.issuedAt))throw new LicenseError("هذا الترخيص غير صالح");
  const signature=strictBase64Url(doc.signature);
  const key=await webcrypto.subtle.importKey("jwk",keys[doc.keyId],{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
  const valid=await webcrypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},key,signature,new TextEncoder().encode(canonicalLicensePayload(p)));
  if(!valid){log("info","license.install.invalid");throw new LicenseError("تعذر التحقق من توقيع الترخيص")}
  if(p.deviceId!==currentDeviceId){log("info","license.device-mismatch");throw new LicenseError("هذا الترخيص مخصص لجهاز آخر")}
  return doc;
}
const info=(p:LicensePayload):LicenseInfo=>({licenseId:p.licenseId,storeId:p.storeId,customerName:p.customerName,storeName:p.storeName,deviceId:p.deviceId,issuedAt:p.issuedAt});
export async function readInstalledLicense(){try{return await readFile(getLicensePath(),"utf8")}catch{return null}}
export async function getLicenseStatus():Promise<LicenseStatus>{
  const content=await readInstalledLicense();if(!content)return {valid:false};
  try{const doc=await verifyLicenseFile(content);log("info","license.status",{valid:true});return {valid:true,license:info(doc.payload)}}catch(error){log("info","license.status",{valid:false,reason:error instanceof Error?error.message:"invalid"});return {valid:false,reason:error instanceof Error?error.message:"هذا الترخيص غير صالح"}}
}
export async function requireValidLicense(){const underNodeTest=process.execArgv.includes("--test")||process.env.NODE_TEST_CONTEXT!==undefined;if(underNodeTest&&process.env.ALKARNA_TEST_LICENSE_BYPASS==="1")return null;const status=await getLicenseStatus();return status.valid?null:Response.json({error:"يجب تفعيل ترخيص الجهاز",code:"LICENSE_REQUIRED"},{status:402})}
export async function installLicense(content:string|Uint8Array,currentDeviceId?:string,keys?:Record<string,JsonWebKey>){
  const doc=await verifyLicenseFile(content,currentDeviceId,keys),path=getLicensePath(),directory=join(path,"..");await mkdir(directory,{recursive:true});
  const temporary=`${path}.${process.pid}.${crypto.randomUUID()}.tmp`,serialized=typeof content==="string"?content:Buffer.from(content);
  try{const handle=await open(temporary,"wx",0o600);try{await writeFile(handle,serialized);await handle.sync()}finally{await handle.close()}await rename(temporary,path)}catch(error){await unlink(temporary).catch(()=>{});throw error}
  log("info","license.install.success",{licenseId:doc.payload.licenseId});return info(doc.payload);
}
