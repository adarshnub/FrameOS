import { describe, expect, it } from "vitest";
import { calculateOpenAiUsage, ProviderRegistry } from "./provider.js";

describe("OpenAI provider usage", () => {
  it("calculates GPT-4.1 mini cached and uncached token cost", () => {
    expect(
      calculateOpenAiUsage("gpt-4.1-mini", {
        usage: {
          input_tokens: 1_000,
          output_tokens: 200,
          total_tokens: 1_200,
          input_tokens_details: { cached_tokens: 400 },
        },
      }),
    ).toMatchObject({
      inputTokens: 1_000,
      cachedInputTokens: 400,
      outputTokens: 200,
      totalTokens: 1_200,
      estimatedCostUsd: 0.0006,
    });
  });

  it("defaults configured OpenAI access to the lower-cost GPT-4.1 mini model", () => {
    const registry = ProviderRegistry.fromEnvironment({
      FRAMEOS_OPENAI_API_KEY: "test-key",
    });
    expect(registry.list()).toEqual([
      { kind: "openai-compatible", model: "gpt-4.1-mini" },
    ]);
  });
});
