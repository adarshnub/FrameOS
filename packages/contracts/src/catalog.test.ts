import { describe, expect, it } from "vitest";
import {
  executableOperationSchemas,
  operationCatalog,
  operationSchema,
} from "./index.js";

describe("operation catalog", () => {
  it("defines a broad advanced-editor taxonomy without pretending contract-only operations work", () => {
    expect(operationCatalog.length).toBeGreaterThanOrEqual(150);
    expect(
      operationCatalog.find((entry) => entry.name === "clip.trim")?.maturity,
    ).toBe("implemented");
    expect(
      operationCatalog.find((entry) => entry.name === "semantic.create_short")
        ?.maturity,
    ).toBe("contract");
    expect(
      operationCatalog.find((entry) => entry.name === "preview.contact_sheet")
        ?.maturity,
    ).toBe("service");
    expect(
      operationCatalog.find((entry) => entry.name === "semantic.find_quote")
        ?.maturity,
    ).toBe("service");
    expect(
      operationCatalog.find(
        (entry) => entry.name === "semantic.remove_silences",
      )?.maturity,
    ).toBe("service");
    expect(
      operationCatalog.find((entry) => entry.name === "asset.proxy.create"),
    ).toMatchObject({
      maturity: "implemented",
      requiredCapabilities: ["asset.proxy.create"],
    });
    expect(
      operationCatalog.find((entry) => entry.name === "asset.thumbnail.create"),
    ).toMatchObject({
      maturity: "service",
      requiredCapabilities: ["asset.thumbnail.create"],
    });
    expect(
      operationCatalog.find((entry) => entry.name === "semantic.make_vertical")
        ?.maturity,
    ).toBe("service");
  });

  it("has executable schemas for every implemented operation", () => {
    const implemented = operationCatalog.filter(
      (entry) => entry.maturity === "implemented",
    );
    expect(implemented.length).toBeGreaterThanOrEqual(150);
    for (const descriptor of implemented) {
      expect(executableOperationSchemas).toHaveProperty(descriptor.name);
      expect(descriptor.readSet.length).toBeGreaterThan(0);
      expect(Array.isArray(descriptor.writeSet)).toBe(true);
      expect(Array.isArray(descriptor.expectedWarnings)).toBe(true);
    }
    expect(operationSchema.options.length).toBe(implemented.length);
  });
});
