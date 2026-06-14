import { describe, expect, it } from "vitest";
import { parseFile } from "./parser.js";

describe("parseFile — issue #83 Java imports", () => {
  it("extracts short imported names from Java imports", () => {
    const result = parseFile(
      [
        "import com.example.core.context.PartitionedHandler;",
        "import static com.example.core.context.PartitionedHandler.create;",
        "public class ScheduleConfig {}",
      ].join("\n"),
      "java",
    );

    expect(result.imports).toEqual([
      {
        source: "com.example.core.context.PartitionedHandler",
        names: ["PartitionedHandler"],
        isRelative: false,
      },
      {
        source: "com.example.core.context.PartitionedHandler",
        names: ["create"],
        isRelative: false,
      },
    ]);
  });
});
