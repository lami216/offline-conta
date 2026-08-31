import { createSession, normalizeUsername, SESSION_COOKIE, sessionCookieOptions, validSameOrigin, verifyPassword } from "../../../../lib/auth";

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return Response.json({ error: "طلب غير صالح" }, { status: 403 });
  const data = await request.formData();
  const password = data.get("password"), username = data.get("username");
  if (typeof password !== "string" || typeof username !== "string") return Response.redirect(new URL("/login?error=1", request.url),303);
  const normalized=normalizeUsername(username);
  if (normalized==="المالك"&&await verifyPassword(password)) return new Response(null,{status:303,headers:{Location:"/","Set-Cookie":`${SESSION_COOKIE}=${createSession({principalType:"owner"})}; ${sessionCookieOptions}`}});
  return Response.redirect(new URL("/login?error=1",request.url),303);
}
