import { describe, expect, it } from "vitest";
import { extractText } from "./vertex-gemini-analyzer.js";
describe("Gemini analysis response integrity", () => {
  it("joins final content and excludes thought summaries", () => {
    expect(
      extractText({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { thought: true, text: "internal summary" },
                { text: '{"segments":' },
                { text: "[]}" },
              ],
            },
          },
        ],
      }),
    ).toBe('{"segments":[]}');
  });
  it("rejects truncated JSON instead of caching it as a shot", () => {
    expect(() =>
      extractText({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: '{"segments":[' }] },
          },
        ],
      }),
    ).toThrow("incomplete");
  });
});
