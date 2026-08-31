import ContaApp from "./conta-app";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "../lib/auth";

export default async function Home() {
  if (!verifySession((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/login");
  return <ContaApp />;
}
