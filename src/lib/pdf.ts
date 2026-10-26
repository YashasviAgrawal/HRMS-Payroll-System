import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { env } from "./env";

/**
 * PDFs (appointment letters, payslips, pay bills, PPO) are rendered from print-ready HTML by headless
 * Chromium. A browser shapes Hindi (Devanagari) correctly; PDF libraries break conjuncts and matras.
 * Fonts are embedded in the page, so the server needs no Hindi fonts installed.
 */
let browserPromise: Promise<Browser> | undefined;

function launch() {
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

/** Logo as a data URL for documents (placeholder SVG until the official file is added). */
export function logoDataUrl(): string {
  const dir = path.join(process.cwd(), "public", "brand");
  for (const [name, mime] of [["logo.png", "image/png"], ["logo.webp", "image/webp"], ["logo.jpg", "image/jpeg"], ["logo.svg", "image/svg+xml"]] as const) {
    try {
      return `data:${mime};base64,${readFileSync(path.join(dir, name)).toString("base64")}`;
    } catch {
      /* try the next file */
    }
  }
  return "";
}
