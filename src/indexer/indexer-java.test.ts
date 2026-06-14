import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Indexer } from "./indexer.js";
import { getProjectConfig } from "../utils/config.js";

describe("Indexer Java impact graph", () => {
  let root: string;
  const originalModelDir = process.env.SVERKLO_MODEL_DIR;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sverklo-java-"));
    process.env.SVERKLO_MODEL_DIR = join(process.cwd(), "models");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (originalModelDir === undefined) {
      delete process.env.SVERKLO_MODEL_DIR;
    } else {
      process.env.SVERKLO_MODEL_DIR = originalModelDir;
    }
  });

  function write(relativePath: string, content: string): void {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  it("connects Java imports and type-only references to impact and PageRank", async () => {
    write(
      "src/main/java/com/example/core/context/PartitionedHandler.java",
      [
        "package com.example.core.context;",
        "",
        "public abstract class PartitionedHandler<T> {",
        "  public abstract void handle(T value);",
        "}",
      ].join("\n"),
    );
    write(
      "src/main/java/com/example/app/ProcessTask.java",
      [
        "package com.example.app;",
        "",
        "import com.example.core.context.PartitionedHandler;",
        "",
        "public class ProcessTask {",
        "  private final PartitionedHandler<ProcessTask> service;",
        "",
        "  public ProcessTask(PartitionedHandler<ProcessTask> service) {",
        "    this.service = service;",
        "  }",
        "}",
      ].join("\n"),
    );
    write(
      "src/main/java/com/example/app/ScheduleConfig.java",
      [
        "package com.example.app;",
        "",
        "import com.example.core.context.PartitionedHandler;",
        "",
        "public class ScheduleConfig {",
        "  PartitionedHandler<ProcessTask> calculationService;",
        "}",
      ].join("\n"),
    );
    write(
      "src/test/java/com/example/app/ServiceTest.java",
      [
        "package com.example.app;",
        "",
        "import com.example.core.context.PartitionedHandler;",
        "",
        "public class ServiceTest {",
        "  public void testHandler() {",
        "    PartitionedHandler<ProcessTask> service = mock(PartitionedHandler.class);",
        "  }",
        "}",
      ].join("\n"),
    );

    const indexer = new Indexer(getProjectConfig(root));
    try {
      await indexer.index();

      const impactPaths = indexer.symbolRefStore
        .getImpact("PartitionedHandler", 20)
        .map((hit) => hit.file_path);
      expect(impactPaths).toEqual(
        expect.arrayContaining([
          "src/main/java/com/example/app/ProcessTask.java",
          "src/main/java/com/example/app/ScheduleConfig.java",
          "src/test/java/com/example/app/ServiceTest.java",
        ]),
      );

      const files = indexer.fileStore.getAll();
      const handler = files.find((file) => file.path.endsWith("PartitionedHandler.java"));
      const schedule = files.find((file) => file.path.endsWith("ScheduleConfig.java"));
      expect(handler?.pagerank ?? 0).toBeGreaterThan(schedule?.pagerank ?? 0);
    } finally {
      indexer.close();
    }
  });
});
