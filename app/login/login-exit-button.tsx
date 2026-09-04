"use client";

export function LoginExitButton() {
  return <button className="login-exit" type="button" onClick={() => window.location.replace("about:blank")}>خروج</button>;
}
