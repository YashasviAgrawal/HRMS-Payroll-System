import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser } from "playwright-core";
import { env } from "./env";

/**
 * PDFs (appointment letters, payslips, pay bills, PPO) are rendered from print-ready HTML by headless
 * Chromium. A browser shapes Hindi (Devanagari) correctly; PDF libraries break conjuncts and matras.
 * Fonts are embedded in the page, so the server needs no Hindi fonts installed.
 */
let browserPromise: Promise<Browser> | undefined;

/**
 * Loaded only when a PDF is made, so pages never depend on the browser being installed. On Vercel (no
 * Chromium on the machine) a Chromium built for serverless functions is used unless CHROMIUM_PATH is set.
 */
async function launch() {
  const { chromium } = await import("playwright-core");
  if (process.env.VERCEL && !env().CHROMIUM_PATH) {
    const serverless = (await import("@sparticuz/chromium")).default;
    return chromium.launch({ executablePath: await serverless.executablePath(), args: [...serverless.args, "--font-render-hinting=none"], headless: true });
  }
  const executablePath = env().CHROMIUM_PATH || undefined;
  return chromium.launch({ executablePath, args: ["--no-sandbox", "--font-render-hinting=none"] });
}

async function browser() {
  browserPromise ??= launch();
  const b = await browserPromise;
  if (!b.isConnected()) {
    browserPromise = launch();
    return browserPromise;
  }
  return b;
}

let fontCss: string | undefined;

/** @font-face rules with the Inter and Noto Sans Devanagari files inlined as data URLs. */
export function embeddedFonts(): string {
  if (fontCss) return fontCss;
  const nm = path.join(process.cwd(), "node_modules");
  const face = (family: string, file: string, weight: string, range?: string) => {
    const data = readFileSync(path.join(nm, file)).toString("base64");
    return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${weight};font-display:block;${range ? `unicode-range:${range};` : ""}}`;
  };
  fontCss = [
    face("Inter", "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "100 900"),
    face("Noto Sans Devanagari", "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2", "400"),
    face("Noto Sans Devanagari", "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-600-normal.woff2", "600"),
    face("Noto Sans Devanagari", "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff2", "700"),
  ].join("\n");
  return fontCss;
}

export async function renderPdf(html: string, opts: { landscape?: boolean } = {}): Promise<Buffer> {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: "A4", landscape: opts.landscape, printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
}

/** The Board's official logo (public/brand/logo.png) as a data URL for documents. */
export function logoDataUrl(): string {
  const dir = path.join(process.cwd(), "public", "brand");
  for (const [name, mime] of [["logo.png", "image/png"], ["logo.webp", "image/webp"], ["logo.jpg", "image/jpeg"]] as const) {
    try {
      return `data:${mime};base64,${readFileSync(path.join(dir, name)).toString("base64")}`;
    } catch {
      /* try the next file */
    }
  }
  return "";
}
