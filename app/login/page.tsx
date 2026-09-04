import { LoginExitButton } from "./login-exit-button";
import { LoginForm } from "./login-form";
import { APP_LOGO_ALT, APP_LOGO_PATH, APP_NAME } from "../../lib/app-brand";

export default function Login() {
  return <main className="login"><div className="login-card"><div className="login-brand"><img src={APP_LOGO_PATH} alt={APP_LOGO_ALT}/></div><h1>{APP_NAME}</h1><p className="login-title">تسجيل الدخول</p><LoginForm exitButton={<LoginExitButton />}/></div></main>;
}
