import { describe, it, expect } from "vitest";
import { parseFile } from "./parser.js";

function dedent(s: string): string {
  const lines = s.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.match(/^(\s*)/)![1].length)
  );
  return lines.map((l) => l.slice(indent)).join("\n") + "\n";
}

function parse(cs: string) {
  return parseFile(cs, "csharp");
}

// ── Namespace parsing ──────────────────────────────────────────────

describe("C# namespace parsing", () => {
  it("extracts a block-scoped namespace", () => {
    const cs = dedent(`
      namespace Foo.Bar
      {
          class Baz { }
      }
    `);
    const result = parse(cs);
    const ns = result.chunks.find((c) => c.type === "module");
    expect(ns).toBeDefined();
    expect(ns!.name).toBe("Foo.Bar");
  });

  it("extracts a file-scoped namespace (C# 10+)", () => {
    const cs = dedent(`
      namespace Foo.Bar;

      class Baz { }
    `);
    const result = parse(cs);
    const ns = result.chunks.find((c) => c.type === "module");
    expect(ns).toBeDefined();
    expect(ns!.name).toBe("Foo.Bar");
  });
});

// ── Class / struct / record / interface / enum ─────────────────────

describe("C# type declarations", () => {
  it("extracts a class", () => {
    const cs = dedent(`
      public class MyClass
      {
          public int X { get; set; }
      }
    `);
    const result = parse(cs);
    const cls = result.chunks.find((c) => c.type === "class" && c.name === "MyClass");
    expect(cls).toBeDefined();
  });

  it("extracts a struct", () => {
    const cs = dedent(`
      public struct Point
      {
          public int X;
          public int Y;
      }
    `);
    const result = parse(cs);
    const s = result.chunks.find((c) => c.type === "class" && c.name === "Point");
    expect(s).toBeDefined();
    expect(s!.content).toContain("public int X;");
    expect(s!.content).toContain("public int Y;");
  });

  it("extracts a plain record", () => {
    const cs = dedent(`
      public record Person(string Name, int Age);
    `);
    const result = parse(cs);
    const r = result.chunks.find((c) => c.name === "Person");
    expect(r).toBeDefined();
    expect(r!.type).toBe("class");
  });

  it("extracts a record class", () => {
    const cs = dedent(`
      public record class Employee(string Name)
      {
          public string Department { get; init; }
      }
    `);
    const result = parse(cs);
    const r = result.chunks.find((c) => c.name === "Employee");
    expect(r).toBeDefined();
    expect(r!.type).toBe("class");
  });

  it("extracts a record struct", () => {
    const cs = dedent(`
      public record struct Coordinate(double Lat, double Lon);
    `);
    const result = parse(cs);
    const r = result.chunks.find((c) => c.name === "Coordinate");
    expect(r).toBeDefined();
    expect(r!.type).toBe("class");
  });

  it("extracts an interface", () => {
    const cs = dedent(`
      public interface IRepository
      {
          void Save();
      }
    `);
    const result = parse(cs);
    const iface = result.chunks.find((c) => c.type === "interface" && c.name === "IRepository");
    expect(iface).toBeDefined();
  });

  it("extracts an enum", () => {
    const cs = dedent(`
      public enum Direction
      {
          North,
          South,
          East,
          West
      }
    `);
    const result = parse(cs);
    const e = result.chunks.find((c) => c.type === "type" && c.name === "Direction");
    expect(e).toBeDefined();
  });
});

// ── Methods and constructors ───────────────────────────────────────

describe("C# methods and constructors", () => {
  it("extracts a method with multiple modifiers (top-level, no wrapping class)", () => {
    // The regex parser's class match consumes the entire class body via
    // findBraceEnd, so methods nested inside a class are not separately
    // extracted — they live inside the class chunk. Test at top level to
    // verify the method regex itself works correctly.
    const cs = dedent(`
      public static async Task<int> ProcessAsync(string input)
      {
          return 42;
      }
    `);
    const result = parse(cs);
    const method = result.chunks.find((c) => c.type === "method" && c.name === "ProcessAsync");
    expect(method).toBeDefined();
    expect(method!.content).toContain("Task<int>");
    expect(method!.content).toContain("string input");
    expect(method!.content).toContain("return 42;");
  });

  it("extracts a constructor (top-level)", () => {
    const cs = dedent(`
      public Widget(int size)
      {
          Size = size;
      }
    `);
    const result = parse(cs);
    const ctor = result.chunks.find((c) => c.type === "method" && c.name === "Widget");
    expect(ctor).toBeDefined();
  });

  // The regex parser consumes the entire class body as a single chunk via
  // findBraceEnd. Methods inside a class are NOT extracted separately —
  // tree-sitter handles that. This test verifies the regex-parser behavior.
  it("class chunk contains method source text even though methods are not separately extracted", () => {
    const cs = dedent(`
      public class Service
      {
          public void DoWork()
          {
              Console.WriteLine("working");
          }
      }
    `);
    const result = parse(cs);
    const cls = result.chunks.find((c) => c.type === "class" && c.name === "Service");
    expect(cls).toBeDefined();
    expect(cls!.content).toContain("DoWork");
    // No separate method chunk — the class chunk spans the full body.
    const methods = result.chunks.filter((c) => c.type === "method");
    expect(methods).toHaveLength(0);
  });

  it("does not match control-flow keywords as methods", () => {
    const cs = dedent(`
      public class Logic
      {
          public void Run()
          {
              if (true)
              {
                  Console.WriteLine("yes");
              }
              for (int i = 0; i < 10; i++)
              {
                  Console.WriteLine(i);
              }
          }
      }
    `);
    const result = parse(cs);
    const names = result.chunks.filter((c) => c.type === "method").map((c) => c.name);
    expect(names).not.toContain("if");
    expect(names).not.toContain("for");
  });

  it("does not match expression statements ending with ) as methods (precedence fix)", () => {
    // Regression test for the operator-precedence bug: a plain call like
    // `foo.Bar(arg)` on its own line should NOT be picked up as a method.
    const cs = dedent(`
      foo.Bar(
          arg1,
          arg2)
    `);
    const result = parse(cs);
    const methods = result.chunks.filter((c) => c.type === "method");
    expect(methods).toHaveLength(0);
  });

  it("does not match a single-line call without modifiers (precedence fix)", () => {
    const cs = dedent(`
      Console.WriteLine("hello")
    `);
    const result = parse(cs);
    const methods = result.chunks.filter((c) => c.type === "method");
    expect(methods).toHaveLength(0);
  });

  it("does not match a LINQ / lambda expression as a method (precedence fix)", () => {
    const cs = dedent(`
      items.Where(x => x > 0)
    `);
    const result = parse(cs);
    const methods = result.chunks.filter((c) => c.type === "method");
    expect(methods).toHaveLength(0);
  });

  it("does not match a field assignment with a call on the right-hand side", () => {
    const cs = dedent(`
      public int Count = GetDefault();
    `);
    const result = parse(cs);
    const methods = result.chunks.filter((c) => c.type === "method");
    expect(methods).toHaveLength(0);
  });

  it("does not match a property with expression body (=> contains =)", () => {
    const cs = dedent(`
      public int Total => ComputeTotal();
    `);
    const result = parse(cs);
    const methods = result.chunks.filter((c) => c.type === "method");
    expect(methods).toHaveLength(0);
  });

  it("does not match a multi-line chained call without modifiers (precedence fix)", () => {
    const cs = dedent(`
      logger
          .WithContext("svc")
          .Info(
              "startup complete")
    `);
    const result = parse(cs);
    const methods = result.chunks.filter((c) => c.type === "method");
    expect(methods).toHaveLength(0);
  });
});

// ── Import (using) detection ───────────────────────────────────────

describe("C# using directives", () => {
  it("parses a plain using directive", () => {
    const cs = dedent(`
      using System.Collections.Generic;
    `);
    const result = parse(cs);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("System.Collections.Generic");
  });

  it("parses using static", () => {
    const cs = dedent(`
      using static System.Math;
    `);
    const result = parse(cs);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("System.Math");
  });

  it("does not confuse a using statement (resource management) with a using directive", () => {
    const cs = dedent(`
      using (var stream = File.OpenRead("x"))
      {
          // read
      }
    `);
    const result = parse(cs);
    expect(result.imports).toHaveLength(0);
  });

  it("parses multiple usings", () => {
    const cs = dedent(`
      using System;
      using System.Linq;
      using static System.Console;
    `);
    const result = parse(cs);
    const sources = result.imports.map((i) => i.source);
    expect(sources).toContain("System");
    expect(sources).toContain("System.Linq");
    expect(sources).toContain("System.Console");
  });
});

// ── Combined file ──────────────────────────────────────────────────

describe("C# combined file", () => {
  it("parses a realistic file with namespace, class, methods, and usings", () => {
    const cs = dedent(`
      using System;
      using System.Threading.Tasks;

      namespace MyApp.Services
      {
          public class UserService
          {
              private readonly ILogger _logger;

              public UserService(ILogger logger)
              {
                  _logger = logger;
              }

              public async Task<User> GetByIdAsync(int id)
              {
                  _logger.Log("fetching");
                  return await _repo.FindAsync(id);
              }

              internal void Reset()
              {
                  _logger.Log("reset");
              }
          }
      }
    `);
    const result = parse(cs);

    // Imports
    const sources = result.imports.map((i) => i.source);
    expect(sources).toContain("System");
    expect(sources).toContain("System.Threading.Tasks");

    // Namespace
    const ns = result.chunks.find((c) => c.type === "module");
    expect(ns).toBeDefined();
    expect(ns!.name).toBe("MyApp.Services");

    // Class
    const cls = result.chunks.find((c) => c.type === "class" && c.name === "UserService");
    expect(cls).toBeDefined();

    // Methods live inside the class chunk (not extracted separately by regex parser),
    // but the class body text should contain them.
    expect(cls!.content).toContain("UserService(ILogger logger)");
    expect(cls!.content).toContain("GetByIdAsync");
    expect(cls!.content).toContain("Reset()");
  });
});
