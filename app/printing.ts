export type PrintProfile = "a4" | "thermal80" | "thermal58";

export type PrinterInfo = {
  name: string;
  displayName: string;
  description?: string;
  status?: number;
  isDefault?: boolean;
};

export type PrintSettings = {
  deviceName: string | null;
  profile: PrintProfile;
};

export type PrintResult = { ok: true } | { ok: false; error: string };

type PrintingBridge = {
  list: () => Promise<PrinterInfo[]>;
  getSettings: () => Promise<PrintSettings>;
  saveSettings: (settings: PrintSettings) => Promise<PrintSettings>;
  print: (options: PrintSettings & { silent: boolean }) => Promise<PrintResult>;
};

declare global {
  interface Window {
    alkarnaPrinting?: PrintingBridge;
  }
}

export const PRINT_PROFILES: PrintProfile[] = ["a4", "thermal80", "thermal58"];
export const DEFAULT_PRINT_SETTINGS: PrintSettings = { deviceName: null, profile: "a4" };

export function normalizePrintSettings(value: unknown): PrintSettings {
  const source = value && typeof value === "object" ? value as Partial<PrintSettings> : {};
  const profile = PRINT_PROFILES.includes(source.profile as PrintProfile) ? source.profile as PrintProfile : "a4";
  const deviceName = typeof source.deviceName === "string" && source.deviceName.trim() ? source.deviceName.trim() : null;
  return { deviceName, profile };
}

export function desktopPrintingAvailable() {
  return typeof window !== "undefined" && Boolean(window.alkarnaPrinting);
}

export async function listPrinters(): Promise<PrinterInfo[]> {
  return window.alkarnaPrinting ? window.alkarnaPrinting.list() : [];
}

export async function loadPrintSettings(): Promise<PrintSettings> {
  if (!window.alkarnaPrinting) return DEFAULT_PRINT_SETTINGS;
  return normalizePrintSettings(await window.alkarnaPrinting.getSettings());
}

export async function savePrintSettings(settings: PrintSettings): Promise<PrintSettings> {
  const normalized = normalizePrintSettings(settings);
  if (!window.alkarnaPrinting) return normalized;
  return normalizePrintSettings(await window.alkarnaPrinting.saveSettings(normalized));
}

const nextFrame = () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

async function waitForPrintAssets() {
  try { await document.fonts?.ready; } catch {}
  const images = [...document.querySelectorAll<HTMLImageElement>(".document-print-portal img")];
  await Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise<void>(resolve => {
    const done = () => resolve();
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
  })));
  await nextFrame();
  await nextFrame();
}

async function browserPrintFallback() {
  await new Promise<void>(resolve => {
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("afterprint", finish);
      if (timer) window.clearTimeout(timer);
      resolve();
    };
    window.addEventListener("afterprint", finish);
    window.print();
    timer = window.setTimeout(finish, 5000);
  });
}

/**
 * Prints the already-rendered `.document-print-portal` using one shared lifecycle.
 * Automatic printing may be silent in Electron; browser fallback always uses the
 * browser/system dialog. Callers must save business data before invoking this.
 */
export async function printPreparedDocument(settings: PrintSettings, silent: boolean): Promise<void> {
  const normalized = normalizePrintSettings(settings);
  const root = document.documentElement;
  const previousProfile = root.dataset.printProfile;
  root.dataset.printProfile = normalized.profile;
  root.classList.add("print-document-mode");
  try {
    await waitForPrintAssets();
    if (window.alkarnaPrinting) {
      const result = await window.alkarnaPrinting.print({ ...normalized, silent });
      if (!result.ok) throw new Error(result.error || "print-failed");
    } else {
      await browserPrintFallback();
    }
  } finally {
    root.classList.remove("print-document-mode");
    if (previousProfile) root.dataset.printProfile = previousProfile;
    else delete root.dataset.printProfile;
  }
}
