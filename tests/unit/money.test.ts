import { describe, expect, it } from "vitest";
import { amountInWords, formatINR, percentOf, roundPaiseToRupee, toPaise } from "@/lib/money";

describe("money", () => {
  it("rounds to the rupee the government way (50 paise and up rounds up)", () => {
    expect(roundPaiseToRupee(12349)).toBe(12300);
    expect(roundPaiseToRupee(12350)).toBe(12400);
    expect(roundPaiseToRupee(12399)).toBe(12400);
    expect(roundPaiseToRupee(-12350)).toBe(-12400);
    expect(roundPaiseToRupee(12301, "UP")).toBe(12400);
    expect(roundPaiseToRupee(12399, "DOWN")).toBe(12300);
  });

  it("PRD worked example: NPS 10% of Basic + DA (₹56,640) is ₹5,664", () => {
    expect(percentOf(toPaise(35400 + 21240), 10)).toBe(toPaise(5664));
  });

  it("DA 60% of ₹35,400 is ₹21,240 and HRA 30% is ₹10,620", () => {
    expect(percentOf(toPaise(35400), 60)).toBe(toPaise(21240));
    expect(percentOf(toPaise(35400), 30)).toBe(toPaise(10620));
  });

  it("formats with Indian digit grouping", () => {
    expect(formatINR(73020)).toBe("₹73,020");
    expect(formatINR(1234567)).toBe("₹12,34,567");
    expect(formatINR(123456789, { paise: true, decimals: true })).toBe("₹12,34,567.89");
    expect(formatINR(null)).toBe("—");
  });

  it("writes amounts in words in English (Indian system)", () => {
    expect(amountInWords(73020)).toBe("Rupees Seventy-Three Thousand Twenty Only");
    expect(amountInWords(1250000)).toBe("Rupees Twelve Lakh Fifty Thousand Only");
    expect(amountInWords(31500000)).toBe("Rupees Three Crore Fifteen Lakh Only");
    expect(amountInWords(101.5)).toBe("Rupees One Hundred One and Fifty Paise Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });

  it("writes amounts in words in Hindi", () => {
    expect(amountInWords(73020, "hi")).toBe("तिहत्तर हज़ार बीस रुपये मात्र");
    expect(amountInWords(1250000, "hi")).toBe("बारह लाख पचास हज़ार रुपये मात्र");
    expect(amountInWords(5664, "hi")).toBe("पाँच हज़ार छह सौ चौंसठ रुपये मात्र");
  });
});
