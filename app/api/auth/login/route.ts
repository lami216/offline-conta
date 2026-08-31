import { createSession, normalizeUsername, SESSION_COOKIE, sessionCookieOptions, validSameOrigin, verifyPassword, verifyPasswordHash } from "../../../../lib/auth";
import { getMongo } from "../../../../lib/mongodb";

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return Response.json({ error: "طلب غير صالح" }, { status: 403 });
  const data = await request.formData();
  const password = data.get("password"), username = data.get("username");
  if (typeof password !== "string" || typeof username !== "string") return Response.redirect(new URL("/login?error=1", request.url),303);
  const normalized=normalizeUsername(username);
  if ((normalized==="owner"||normalized==="المالك")&&verifyPassword(password)) return new Response(null,{status:303,headers:{Location:"/","Set-Cookie":`${SESSION_COOKIE}=${createSession({principalType:"owner"})}; ${sessionCookieOptions}`}});
  const user=await (await getMongo()).collection("users").findOne({usernameNormalized:normalized,isActive:true});
  if(!user||!verifyPasswordHash(password,String(user.passwordHash??""))) return Response.redirect(new URL("/login?error=1",request.url),303);
  return new Response(null,{status:303,headers:{Location:"/","Set-Cookie":`${SESSION_COOKIE}=${createSession({principalType:"user",userId:String(user.id)})}; ${sessionCookieOptions}`}});
}
