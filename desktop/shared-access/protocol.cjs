/* eslint-disable @typescript-eslint/no-require-imports */
const {createHash,createPublicKey,sign,verify}=require('node:crypto');
const APPLICATION_ID='mr.alkarna.desktop',PATH='/api/desktop/access/v1/dispatch';
const fault=(code,message=code)=>Object.assign(new Error(message),{code});
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 if(value===undefined||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint'||typeof value==='number'&&!Number.isFinite(value))throw fault('INVALID_CANONICAL_VALUE');
 return JSON.stringify(value);
}
const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const fingerprint=key=>createHash('sha256').update(canonical({crv:key.crv,kty:key.kty,x:key.x,y:key.y})).digest('base64url');
function verifyEnvelope(envelope,issuers,schema,scope={},now=Date.now()){
 if(!envelope||envelope.schema!==schema||envelope.version!==1||typeof envelope.kid!=='string'||!issuers[envelope.kid]||typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))throw fault('INVALID_SERVICE_SIGNATURE');
 const {signature,...signed}=envelope;
 if(!verify('sha256',Buffer.from(canonical(signed)),{key:createPublicKey({key:issuers[envelope.kid],format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')))throw fault('INVALID_SERVICE_SIGNATURE');
 const p=envelope.payload;
 if(!p||Object.entries(scope).some(([key,value])=>p[key]!==value)||p.applicationId!==APPLICATION_ID)throw fault('WRONG_GRANT_SCOPE');
 if(!Number.isFinite(p.issuedAt)||!Number.isFinite(p.expiresAt)||p.issuedAt>now+120000||p.expiresAt<=now||p.expiresAt<=p.issuedAt)throw fault('EXPIRED_SERVICE_GRANT');
 return p;
}
function signChallenge(challenge,operation,payload,sessionToken,privateKey,now=Date.now()){
 if(!challenge||typeof challenge.message!=='string'||challenge.message.length>16384||typeof challenge.challengeId!=='string')throw fault('INVALID_CHALLENGE');
 let p;try{p=JSON.parse(challenge.message)}catch{throw fault('INVALID_CHALLENGE')}
 if(p.schema!=='contatools-desktop-access-proof'||p.version!==1||p.method!=='POST'||p.path!==PATH||p.operation!==operation||p.applicationId!==APPLICATION_ID||p.installationId!==payload.installationId||p.payloadHash!==hash(payload)||p.sessionTokenHash!==(sessionToken?hash(sessionToken):null)||canonical(p)!==challenge.message||!Number.isFinite(Date.parse(p.expiresAt))||!Number.isFinite(Date.parse(p.issuedAt))||typeof p.nonce!=='string'||p.nonce.length<6||Date.parse(p.expiresAt)<=Date.parse(p.issuedAt)||Date.parse(p.expiresAt)-Date.parse(p.issuedAt)>120000||Date.parse(p.expiresAt)<=now||Date.parse(p.issuedAt)>now+120000)throw fault('INVALID_CHALLENGE_SCOPE');
 return sign('sha256',Buffer.from(challenge.message),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
function normalizedPhone(value){return String(value).normalize('NFKC').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).trim();}
module.exports={APPLICATION_ID,PATH,canonical,hash,fingerprint,fault,verifyEnvelope,signChallenge,normalizedPhone};
