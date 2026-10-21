import { describe, expect, it } from "vitest";
import { formatPluginCount } from "@/lib/formatters";

describe("formatPluginCount", () => {
  it("uses the singular for exactly one", () => {
    expect(formatPluginCount(1)).toBe("1 plugin");
  });
  it("uses the plural for zero and many", () => {
    expect(formatPluginCount(0)).toBe("0 plugins");
    expect(formatPluginCount(2)).toBe("2 plugins");
    expect(formatPluginCount(120)).toBe("120 plugins");
  });
});
