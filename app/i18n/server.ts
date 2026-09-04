import { messages, type MessageKey } from "./messages";
import { LOCALE_COOKIE, normalizeLocale } from "./locale";

export function requestLocale(request: Request) {
  const cookies=request.headers.get("cookie") ?? "";
  const value=cookies.split(";").map(part=>part.trim().split("=")).find(([name])=>name===LOCALE_COOKIE)?.[1];
  return normalizeLocale(value);
}

export function localizeMessage(request: Request, arabic: string) {
  const locale=requestLocale(request);
  return (messages[locale] as Record<string,string>)[arabic as MessageKey] ?? arabic;
}
