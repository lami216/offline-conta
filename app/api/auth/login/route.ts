import { createSession, normalizeUsername, SESSION_COOKIE, sessionCookieOptions, validSameOrigin, verifyPasswordHash } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/sqlite";

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return Response.json({ error: "طلب غير صالح" }, { status: 403 });
  const data = await request.formData();
  const password = data.get("password"), username = data.get("username");
  if (typeof password !== "string" || typeof username !== "string") return Response.redirect(new URL("/login?error=1", request.url),303);
  const normalized=normalizeUsername(username);
  const user=await (await getDatabase()).collection("users").findOne({usernameNormalized:normalized,isActive:true});
  if(user&&verifyPasswordHash(password,String(user.passwordHash??""))){const principal=user.owner===true?{principalType:"owner" as const}:{principalType:"user" as const,userId:String(user.id)};return new Response(null,{status:303,headers:{Location:"/","Set-Cookie":`${SESSION_COOKIE}=${createSession(principal)}; ${sessionCookieOptions}`}})}
  return Response.redirect(new URL("/login?error=1",request.url),303);
}
