import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

describe("CLI run()", () => {
  it("and run([], io) returns 2", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run([], {
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
    });
    expect(code).toBe(2);
    expect(stderr.join("")).toContain("Usage:");
  });

  it("returns 2 when the specified file does not exist", async () => {
    const stderr: string[] = [];
    const code = await run(["/nonexistent/path/db.sqlite"], {
      stdout: () => {},
      stderr: (s) => stderr.push(s),
    });
    expect(code).toBe(2);
    expect(stderr.join("")).toContain("Failed to read SQLite file");
  });

  it("returns 0 when valid database is provided", async () => {
    const SQL = await initSqlJs();
    const mem = new SQL.Database();
    mem.exec("CREATE TABLE sample (id INT);");
    const data = mem.export();
    mem.close();

    const tempPath = join(
      tmpdir(),
      `test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
    );
    await writeFile(tempPath, data);

    const stderr: string[] = [];
    const code = await run([tempPath], {
      stdout: () => {},
      stderr: (s) => stderr.push(s),
    });
    expect(code).toBe(0);
    await unlink(tempPath);
  });
});
