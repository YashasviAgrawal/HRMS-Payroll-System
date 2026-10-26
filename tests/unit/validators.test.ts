import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isValidAadhaar, isValidIfsc, isValidPan, normaliseMobile, optionalNumber, verhoeffCheckDigit } from "@/lib/validators";

describe("identity validators (EM-03)", () => {
  it("accepts an individual's PAN only", () => {
    expect(isValidPan("ABCPE1234F")).toBe(true);
    expect(isValidPan("abcpe1234f")).toBe(true);
    expect(isValidPan("ABCCE1234F")).toBe(false); // company PAN
    expect(isValidPan("ABCPE12345")).toBe(false);
  });

  it("checks Aadhaar with the Verhoeff checksum", () => {
    const base = "23456789012";
    const valid = base + verhoeffCheckDigit(base);
    expect(isValidAadhaar(valid)).toBe(true);
    expect(isValidAadhaar(`${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`)).toBe(true);
    const wrong = base + ((verhoeffCheckDigit(base) + 1) % 10);
    expect(isValidAadhaar(wrong)).toBe(false);
    expect(isValidAadhaar("123456789012")).toBe(false); // cannot start with 1
  });

  it("checks IFSC and normalises mobiles", () => {
    expect(isValidIfsc("SBIN0001234")).toBe(true);
    expect(isValidIfsc("SBIN1001234")).toBe(false);
    expect(normaliseMobile("+91 98765 43210")).toBe("9876543210");
    expect(normaliseMobile("09876543210")).toBe("9876543210");
  });

  it("keeps a blank optional number blank instead of 0", () => {
    const score = optionalNumber(z.number().min(0));
    expect(score.parse("")).toBeNull();
    expect(score.parse("  ")).toBeNull();
    expect(score.parse(null)).toBeNull();
    expect(score.parse(undefined)).toBeNull();
    expect(score.parse("0")).toBe(0);
    expect(score.parse("72.5")).toBe(72.5);
    expect(score.safeParse("abc").success).toBe(false);
    expect(optionalNumber(z.number().int().min(1)).safeParse("0").success).toBe(false);
  });
});
