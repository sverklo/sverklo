import { describe, it, expect } from "vitest";
import {
  generateAuditHtml,
  cleanProjectName,
  deriveSourceLink,
} from "./audit-html.js";

const SAMPLE_MD = `# Sverklo Project Audit — Grade: B

| Dimension | Score | Detail |
|---|---|---|
| Dead code | B | 8 of 415 symbols unreferenced |
| Circular deps | A | No cycles detected |
| Coupling | C | Top file has PageRank 1.00 |
| Security | F | 4 critical issues |

## Overview

- **141** files indexed
- **415** code symbols extracted
`;

describe("cleanProjectName", () => {
  it("strips 'report-' prefix", () => {
    expect(
      cleanProjectName("report-expressjs_express", "/private/tmp/report-expressjs_express"),
    ).toBe("expressjs/express");
  });

  it("strips 'regen-' prefix", () => {
    expect(
      cleanProjectName("regen-claude-mem", "/private/tmp/regen-claude-mem"),
    ).toBe("claude-mem");
  });

  it("strips 'bench-' prefix", () => {
    expect(
      cleanProjectName("bench-nest", "/tmp/bench-nest"),
    ).toBe("nest");
  });

  it("strips version-style prefixes like 'v12-'", () => {
    expect(
      cleanProjectName("v12-foo_bar", "/tmp/v12-foo_bar"),
    ).toBe("foo/bar");
  });

  it("leaves a clean name untouched", () => {
    expect(
      cleanProjectName("sverklo", "/Users/nikita/projects/sverklo"),
    ).toBe("sverklo");
  });

  it("prefers basename of projectPath over projectName", () => {
    expect(
      cleanProjectName("report-expressjs_express", "/Users/me/real-project"),
    ).toBe("real-project");
  });
});

describe("deriveSourceLink", () => {
  it("builds a GitHub URL from 'owner_repo' form", () => {
    expect(
      deriveSourceLink("report-expressjs_express", "/private/tmp/report-expressjs_express"),
    ).toBe("https://github.com/expressjs/express");
  });

  it("returns empty string when owner/repo can't be derived", () => {
    expect(
      deriveSourceLink("regen-claude-mem", "/private/tmp/regen-claude-mem"),
    ).toBe("");
  });

  it("returns empty string for regular project paths", () => {
    expect(
      deriveSourceLink("sverklo", "/Users/nikita/projects/sverklo"),
    ).toBe("");
  });
});

describe("generateAuditHtml", () => {
  const html = generateAuditHtml(
    SAMPLE_MD,
    "report-expressjs_express",
    "/private/tmp/report-expressjs_express",
  );

  it("renders the site-standard top header with brand + nav", () => {
    expect(html).toContain('<header class="top">');
    expect(html).toContain('class="brand"');
    expect(html).toContain('class="top-nav"');
    expect(html).toContain("All reports");
    expect(html).toContain("https://github.com/sverklo/sverklo");
    expect(html).toContain("https://www.npmjs.com/package/sverklo");
  });

  it("populates dimension cards (P0-1 fix)", () => {
    expect(html).toContain("Dead code");
    expect(html).toContain("Circular deps");
    expect(html).toContain("Coupling");
    expect(html).toContain("Security");
    // Empty dimensions block regression check:
    expect(html).not.toMatch(/<div class="dimensions">\s*<\/div>/);
  });

  it("uses a clean owner/repo display name in title and header (P0-7 fix)", () => {
    expect(html).toContain("<title>Sverklo Audit — expressjs/express</title>");
    expect(html).toContain('<span class="project-name">expressjs/express</span>');
    expect(html).not.toContain("report-expressjs_express");
  });

  it("replaces the /private/tmp path with the GitHub URL (P1-7 fix)", () => {
    expect(html).not.toContain("/private/tmp/");
    expect(html).toContain("https://github.com/expressjs/express");
  });

  it("still renders overall grade ring", () => {
    expect(html).toContain("grade-letter");
    expect(html).toMatch(/>B</);
  });
});
