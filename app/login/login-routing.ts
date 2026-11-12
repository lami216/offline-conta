/** Internal routing after the local account rejects an unknown identifier. */
export function canonicalPhoneIdentifier(value:string){return value.normalize("NFKC").replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).trim();}
export function remoteEntryKind(value:string):"phone"|"organization"|"none"{
 const identifier=value.normalize("NFKC").trim(),phone=canonicalPhoneIdentifier(identifier);
 if(/^[234][0-9]{7}$/.test(phone))return "phone";
 return /^\S+@\S+\.\S+$/.test(identifier)?"organization":"none";
}
