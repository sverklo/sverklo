import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSverkloConfig, getWeight } from "./config-file.js";

describe("loadSverkloConfig", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns null when no config file exists", () => {
    expect(loadSverkloConfig(tmpRoot)).toBeNull();
  });

  it("loads a valid .sverklo.yaml file", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `weights:\n  - glob: "src/**"\n    weight: 2.0\nignore:\n  - node_modules\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config).not.toBeNull();
    expect(config!.weights).toHaveLength(1);
    expect(config!.weights![0].glob).toBe("src/**");
    expect(config!.weights![0].weight).toBe(2.0);
    expect(config!.ignore).toEqual(["node_modules"]);
  });

  it("loads .sverklo.yml as fallback", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yml"),
      `weights:\n  - glob: "lib/**"\n    weight: 1.5\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config).not.toBeNull();
    expect(config!.weights![0].glob).toBe("lib/**");
  });

  it("prefers .sverklo.yaml over .sverklo.yml when both exist", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `weights:\n  - glob: "from-yaml"\n    weight: 1.0\n`,
      "utf-8"
    );
    writeFileSync(
      join(tmpRoot, ".sverklo.yml"),
      `weights:\n  - glob: "from-yml"\n    weight: 1.0\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config!.weights![0].glob).toBe("from-yaml");
  });

  it("returns null for empty YAML", () => {
    writeFileSync(join(tmpRoot, ".sverklo.yaml"), "", "utf-8");
    expect(loadSverkloConfig(tmpRoot)).toBeNull();
  });

  it("returns null for non-object YAML (scalar)", () => {
    writeFileSync(join(tmpRoot, ".sverklo.yaml"), "just a string", "utf-8");
    expect(loadSverkloConfig(tmpRoot)).toBeNull();
  });

  it("returns null for invalid YAML syntax", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      "weights:\n  - glob: [unterminated",
      "utf-8"
    );
    expect(loadSverkloConfig(tmpRoot)).toBeNull();
  });

  it("clamps weights above 10.0 to 10.0", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `weights:\n  - glob: "**"\n    weight: 99.0\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config!.weights![0].weight).toBe(10.0);
  });

  it("clamps negative weights to 0.0", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `weights:\n  - glob: "**"\n    weight: -5.0\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config!.weights![0].weight).toBe(0.0);
  });

  it("filters out weight entries with non-finite values (Infinity, NaN)", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `weights:\n  - glob: "a"\n    weight: .inf\n  - glob: "b"\n    weight: 3.0\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config!.weights).toHaveLength(1);
    expect(config!.weights![0].glob).toBe("b");
  });

  it("filters out malformed weight entries (missing glob or weight)", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `weights:\n  - glob: "ok"\n    weight: 1.0\n  - weight: 2.0\n  - glob: "missing-weight"\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config!.weights).toHaveLength(1);
    expect(config!.weights![0].glob).toBe("ok");
  });

  it("discards ignore when it is not an array", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `ignore: "not-an-array"\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config!.ignore).toBeUndefined();
  });

  it("filters non-string entries from ignore array", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `ignore:\n  - node_modules\n  - 42\n  - dist\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config!.ignore).toEqual(["node_modules", "dist"]);
  });

  it("loads search config section", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `search:\n  defaultTokenBudget: 8000\n  maxResults: 20\n  budgets:\n    overview: 4000\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config!.search!.defaultTokenBudget).toBe(8000);
    expect(config!.search!.maxResults).toBe(20);
    expect(config!.search!.budgets!.overview).toBe(4000);
  });

  it("loads embeddings config section", () => {
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      `embeddings:\n  provider: ollama\n  ollama:\n    baseUrl: http://localhost:11434\n    model: nomic-embed-text\n`,
      "utf-8"
    );
    const config = loadSverkloConfig(tmpRoot);
    expect(config!.embeddings!.provider).toBe("ollama");
    expect(config!.embeddings!.ollama!.baseUrl).toBe("http://localhost:11434");
  });
});

describe("getWeight", () => {
  it("returns 1.0 when config is null", () => {
    expect(getWeight(null, "src/foo.ts")).toBe(1.0);
  });

  it("returns 1.0 when config has no weights", () => {
    expect(getWeight({}, "src/foo.ts")).toBe(1.0);
  });

  it("returns 1.0 when no glob matches", () => {
    const config = { weights: [{ glob: "lib/**", weight: 3.0 }] };
    expect(getWeight(config, "src/foo.ts")).toBe(1.0);
  });

  it("returns the matching weight for a glob", () => {
    const config = { weights: [{ glob: "src/**", weight: 2.5 }] };
    expect(getWeight(config, "src/foo.ts")).toBe(2.5);
  });

  it("last matching glob wins", () => {
    const config = {
      weights: [
        { glob: "src/**", weight: 2.0 },
        { glob: "src/core/**", weight: 5.0 },
      ],
    };
    expect(getWeight(config, "src/core/index.ts")).toBe(5.0);
  });

  it("returns first match weight when later globs do not match", () => {
    const config = {
      weights: [
        { glob: "src/**", weight: 2.0 },
        { glob: "lib/**", weight: 5.0 },
      ],
    };
    expect(getWeight(config, "src/foo.ts")).toBe(2.0);
  });
});
