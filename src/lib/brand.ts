import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

let cached: string | undefined;

/**
 * The Board logo. Drop the official file at public/brand/logo.png (or .webp / .jpg) and it is used
 * everywhere — login screen, sidebar, payslips — with no code change. Otherwise the placeholder SVG shows.
 */
export function logoSrc(): string {
  if (cached) return cached;
  const dir = path.join(process.cwd(), "public", "brand");
  for (const name of ["logo.png", "logo.webp", "logo.jpg", "logo.jpeg"]) {
    if (existsSync(path.join(dir, name))) return (cached = `/brand/${name}`);
  }
  return (cached = "/brand/logo.svg");
}
