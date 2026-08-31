import { LoginExitButton } from "./login-exit-button";
import { APP_LOGO_ALT, APP_LOGO_PATH, APP_NAME } from "../../lib/app-brand";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const error = (await searchParams).error;
  return <main className="login"><form className="login-card" action="/api/auth/login" method="post"><div className="login-brand"><img src={APP_LOGO_PATH} alt={APP_LOGO_ALT}/></div><h1>{APP_NAME}</h1><p className="login-title">تسجيل الدخول</p><label>اسم المستخدم<input name="username" required autoComplete="username" /></label><label>كلمة المرور<input name="password" type="password" required autoComplete="current-password" /></label>{error && <p className="login-error" role="alert">اسم المستخدم أو كلمة المرور غير صحيحة</p>}<div className="login-actions"><button className="login-submit" type="submit">تسجيل الدخول</button><LoginExitButton /></div></form></main>;
}
