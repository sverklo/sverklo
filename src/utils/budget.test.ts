import { describe, it, expect } from "vitest";
import { resolveBudget } from "./budget.js";
import type { SverkloConfig } from "./config-file.js";

describe("resolveBudget", () => {
  const HARD_DEFAULT = 4000;
  const TOOL_NAME = "overview";

  it("returns the explicit arg when token_budget is a positive number", () => {
    const result = resolveBudget(
      { token_budget: 8000 },
      TOOL_NAME,
      null,
      HARD_DEFAULT
    );
    expect(result).toBe(8000);
  });

  it("ignores explicit arg when token_budget is zero", () => {
    const result = resolveBudget(
      { token_budget: 0 },
      TOOL_NAME,
      null,
      HARD_DEFAULT
    );
    expect(result).toBe(HARD_DEFAULT);
  });

  it("ignores explicit arg when token_budget is negative", () => {
    const result = resolveBudget(
      { token_budget: -100 },
      TOOL_NAME,
      null,
      HARD_DEFAULT
    );
    expect(result).toBe(HARD_DEFAULT);
  });

  it("ignores explicit arg when token_budget is not a number", () => {
    const result = resolveBudget(
      { token_budget: "big" },
      TOOL_NAME,
      null,
      HARD_DEFAULT
    );
    expect(result).toBe(HARD_DEFAULT);
  });

  it("returns per-tool budget from config when no explicit arg", () => {
    const config: SverkloConfig = {
      search: { budgets: { overview: 6000 } },
    };
    const result = resolveBudget({}, TOOL_NAME, config, HARD_DEFAULT);
    expect(result).toBe(6000);
  });

  it("returns global default from config when no explicit arg and no per-tool budget", () => {
    const config: SverkloConfig = {
      search: { defaultTokenBudget: 10000 },
    };
    const result = resolveBudget({}, TOOL_NAME, config, HARD_DEFAULT);
    expect(result).toBe(10000);
  });

  it("returns hard default when config is null and no explicit arg", () => {
    const result = resolveBudget({}, TOOL_NAME, null, HARD_DEFAULT);
    expect(result).toBe(HARD_DEFAULT);
  });

  it("returns hard default when config has no search section", () => {
    const config: SverkloConfig = { weights: [] };
    const result = resolveBudget({}, TOOL_NAME, config, HARD_DEFAULT);
    expect(result).toBe(HARD_DEFAULT);
  });

  // Priority chain: explicit arg > per-tool > global > hard default
  it("explicit arg takes priority over per-tool config", () => {
    const config: SverkloConfig = {
      search: { budgets: { overview: 6000 }, defaultTokenBudget: 10000 },
    };
    const result = resolveBudget(
      { token_budget: 2000 },
      TOOL_NAME,
      config,
      HARD_DEFAULT
    );
    expect(result).toBe(2000);
  });

  it("per-tool config takes priority over global default", () => {
    const config: SverkloConfig = {
      search: { budgets: { overview: 6000 }, defaultTokenBudget: 10000 },
    };
    const result = resolveBudget({}, TOOL_NAME, config, HARD_DEFAULT);
    expect(result).toBe(6000);
  });

  it("skips per-tool budget when it is zero or negative", () => {
    const config: SverkloConfig = {
      search: { budgets: { overview: 0 }, defaultTokenBudget: 10000 },
    };
    const result = resolveBudget({}, TOOL_NAME, config, HARD_DEFAULT);
    expect(result).toBe(10000);
  });

  it("skips global default when it is zero or negative", () => {
    const config: SverkloConfig = {
      search: { defaultTokenBudget: -1 },
    };
    const result = resolveBudget({}, TOOL_NAME, config, HARD_DEFAULT);
    expect(result).toBe(HARD_DEFAULT);
  });
});
