"use client";
import {type FormEvent,type ReactNode,useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {useI18n} from "../i18n/provider";
import {translateApiError} from "../i18n/api-errors";
import {accessCall,completeLocalLogin,type AccessView} from "../shared-access-client";
import {canonicalPhoneIdentifier,remoteEntryKind} from "./login-routing";

export function LoginForm({exitButton}:{exitButton:ReactNode}){
 const {t,locale}=useI18n(),router=useRouter(),text=(ar:string,fr:string)=>locale==="ar"?ar:fr;
 const [username,setUsername]=useState(""),[password,setPassword]=useState(""),[consent,setConsent]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[submitting,setSubmitting]=useState(false),[nativeAvailable,setNativeAvailable]=useState(false),[view,setView]=useState<AccessView|null>(null);
 const usernameRef=useRef<HTMLInputElement>(null),passwordRef=useRef<HTMLInputElement>(null),busy=useRef(false),mounted=useRef(true);
 const institutionHint=text("تواصل مع مسؤول منشأتك للحصول على بيانات الدخول.","Contactez le responsable de votre établissement pour obtenir vos identifiants.");
 const pendingNotice=text("أُرسل طلب جهازك إلى المسؤول. انتظر الموافقة، ثم سجّل الدخول من جديد.","La demande de votre appareil a été envoyée au responsable. Après approbation, reconnectez-vous.");
 const syncState=useCallback(async()=>{
  let next=await accessCall("state");
  if(next.request&&["approved","accepted-local"].includes(next.request.stage)){await accessCall("activate");next=await accessCall("state");}
  if(mounted.current)setView(next);return next;
 },[]);
 useEffect(()=>{mounted.current=true;const timer=setTimeout(()=>{setNativeAvailable(!!window.alkarnaAccess);if(window.alkarnaAccess)void syncState().catch(()=>{});},0);return()=>{mounted.current=false;clearTimeout(timer);};},[syncState]);
 async function localLogin(name:string,secret:string){
  const body=new FormData();body.set("username",name);body.set("password",secret);
  const response=await fetch("/api/auth/login",{method:"POST",headers:{"x-alkarna-login-ui":"1"},body});
  const result=await response.json() as {ok:boolean;field?:"username"|"password";error?:string};
  return{response,result,known:response.headers.get("x-alkarna-local-account")!=="unknown",scope:response.headers.get("x-alkarna-local-account-change")};
 }
 const enterLocal=(scope:string|null)=>{if(scope!=="same"&&scope!=="changed")throw Error("LOCAL_SESSION_UNCONFIRMED");completeLocalLogin(scope);router.replace("/");router.refresh();};
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy.current)return;busy.current=true;setSubmitting(true);setError("");setNotice("");
  try{
   const entryKind=remoteEntryKind(username);let local=await localLogin(username,password);
   if(!local.result.ok&&local.result.field==="username"&&!local.known&&entryKind==="phone"&&canonicalPhoneIdentifier(username)!==username.trim())local=await localLogin(canonicalPhoneIdentifier(username),password);
   if(local.response.ok&&local.result.ok){enterLocal(local.scope);return;}
   if(local.result.field!=="username"||local.known){setError(translateApiError(locale,local.result.error??"تعذر تسجيل الدخول"));if(local.result.field==="username"){setUsername("");requestAnimationFrame(()=>usernameRef.current?.focus());}else if(local.result.field==="password"){setPassword("");requestAnimationFrame(()=>passwordRef.current?.focus());}return;}
   if(!nativeAvailable||entryKind==="none"){setError(institutionHint);setUsername("");requestAnimationFrame(()=>usernameRef.current?.focus());return;}
   if(!consent){setError(text("وافق على التحقق من بيانات الدخول والجهاز للمتابعة.","Acceptez la vérification des identifiants et de cet appareil pour continuer."));return;}
   const entered=await accessCall("enter",{identifier:username,code:password,consent:true}),next=await syncState();
   if(entered.kind==="organization"){
    setPassword("");if(entered.stage==="pending"){setNotice(pendingNotice);return;}
    if(next.session){router.replace("/shared");return;}
    throw Error("ACCOUNT_ACCESS_UNCONFIRMED");
   }
   if(next.license.valid&&next.request?.stage==="linked"){
    const activated=await localLogin(canonicalPhoneIdentifier(username),password);
    if(activated.response.ok&&activated.result.ok){setPassword("");enterLocal(activated.scope);return;}
    setNotice(text("هذا الجهاز جاهز. استخدم بيانات الحساب المحلي الموجود للدخول.","Cet appareil est prêt. Utilisez les identifiants du compte local existant."));
   }else setNotice(pendingNotice);
   setPassword("");
  }catch(reason){
   const code=String((reason as {code?:string})?.code||""),message=reason instanceof Error?reason.message:"";
   setError(/INVALID_IDENTIFIER|INVALID_CREDENTIALS|INVALID_REQUEST|REQUEST_ALREADY_EXISTS|Invalid credentials|unapproved desktop/i.test(code+" "+message)?institutionHint:/fetch failed|Failed to fetch|ECONN|ETIMEDOUT|NETWORK|SERVICE_UNAVAILABLE|WINDOWS_LICENSE_UNAVAILABLE/i.test(code+" "+message)?text("تعذّر الاتصال بخدمة الحساب. تحقق من الاتصال وأعد المحاولة.","Connexion au service indisponible. Vérifiez le réseau et réessayez."):message||t("تعذر الاتصال بالتطبيق"));
  }finally{busy.current=false;if(mounted.current)setSubmitting(false);}
 }
 async function logout(){if(busy.current)return;busy.current=true;setSubmitting(true);setError("");try{await accessCall("logout");await syncState();setNotice("");}catch(reason){setError(reason instanceof Error?reason.message:t("تعذر الاتصال بالتطبيق"));}finally{busy.current=false;if(mounted.current)setSubmitting(false);}}
 return <form onSubmit={submit} aria-busy={submitting}>
  <label>{t("اسم المستخدم")}<input ref={usernameRef} name="username" required maxLength={254} autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)}/></label>
  <label>{t("كلمة المرور")}<input ref={passwordRef} name="password" type="password" required maxLength={256} autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>
  {nativeAvailable&&<label className="login-consent"><input name="consent" type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>{text("أوافق على إرسال بيانات الدخول وهوية هذا الجهاز ومفتاحه العام وبيانات ترخيصه القائم إلى خدمة الحساب للتحقق.","J’accepte l’envoi des identifiants, de l’identité et de la clé publique de cet appareil et des informations de sa licence au service de compte pour vérification.")}</span></label>}
  {(notice||view?.organizationAccess||view?.request?.stage==="pending")&&<p className="login-notice" role="status">{notice||pendingNotice}</p>}
  {error&&<p className="login-error" role="alert">{error}</p>}
  <div className="login-actions"><button className="login-submit" type="submit" disabled={submitting}>{submitting?t("جارٍ الدخول..."):t("تسجيل الدخول")}</button>{exitButton}</div>
  {view?.session&&<div className="login-session-actions"><button className="soft" type="button" onClick={()=>router.replace("/shared")}>{text("متابعة العمل","Continuer")}</button><button className="soft" type="button" disabled={submitting||!!view.pending||!!view.receipt} onClick={()=>void logout()}>{text("تسجيل الخروج","Se déconnecter")}</button></div>}
 </form>;
}
