import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { hi } from "@/lib/i18n/hi";
import { makeT } from "@/lib/i18n";

function leaves(obj: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of leaves(v, key)) out.set(kk, vv);
  }
  return out;
}

describe("Hindi and English text (PRD §16)", () => {
  const enKeys = leaves(en);
  const hiKeys = leaves(hi);

  it("have exactly the same keys", () => {
    expect([...hiKeys.keys()].sort()).toEqual([...enKeys.keys()].sort());
  });

  it("have no empty strings", () => {
    for (const [k, v] of [...enKeys, ...hiKeys]) expect(v.trim(), k).not.toBe("");
  });

  it("keep the same {placeholders} in both languages", () => {
    for (const [k, v] of enKeys) {
      const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(names(hiKeys.get(k)!), k).toEqual(names(v));
    }
  });

  it("interpolates values", () => {
    expect(makeT("en")("login.otpSentTo", { mobile: "******3210" })).toBe("We sent a 6-digit code to ******3210.");
    expect(makeT("hi")("home.goodMorning", { name: "प्रिया" })).toBe("सुप्रभात, प्रिया");
  });
});
