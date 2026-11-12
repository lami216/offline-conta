import {timingSafeEqual} from "node:crypto";
export function desktopAccessAllowed(request:Request){
 if(process.env.ALKARNA_DESKTOP!=="1")return false;
 const expected=process.env.ALKARNA_DESKTOP_TOKEN??"",given=request.headers.get("x-alkarna-desktop-token")??"";
 const a=Buffer.from(expected),b=Buffer.from(given);
 return !!expected&&a.length===b.length&&timingSafeEqual(a,b)&&!request.headers.get("cookie")&&!request.headers.get("origin");
}
