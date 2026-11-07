import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import {
  checkSql,
  createServer,
  MAX_SQL_LENGTH,
  openDatabase,
  type ReadonlyDb,
  SqliteMcpError,
} from "../src/index.js";

async function buildDb(sql: string): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const mem = new SQL.Database();
  if (sql) {
    mem.exec(sql);
  }
  const data = mem.export();
  mem.close();
  return data;
}

function captureError(fn: () => unknown): SqliteMcpError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SqliteMcpError);
    return e as SqliteMcpError;
  }
  throw new Error("expected function to throw");
}

async function connect(db: ReadonlyDb): Promise<Client> {
  const server = createServer(db, { name: "edge", version: "9.9.9" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "edge-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function firstText(res: Record<string, unknown>): string {
  const content = res.content as Array<{ text: string }>;
  return content[0]?.text ?? "";
}

describe("SqliteMcpError", () => {
  it("truncates messages longer than 200 characters to 197 characters plus '...'", () => {
    const err = new SqliteMcpError("SQL_ERROR", "x".repeat(250));
    expect(err.message).toBe(`${"x".repeat(197)}...`);
    expect(err.message.length).toBe(200);
    expect(err.code).toBe("SQL_ERROR");
    expect(err.name).toBe("SqliteMcpError");
  });

  it("keeps messages of exactly 200 characters unchanged", () => {
    const err = new SqliteMcpError("TOO_LARGE", "y".repeat(200));
    expect(err.message).toBe("y".repeat(200));
  });
});

describe("checkSql edge cases", () => {
  it("rejects SQL longer than MAX_SQL_LENGTH with code TOO_LARGE", () => {
    const err = captureError(() => checkSql(`SELECT 1 ${" ".repeat(MAX_SQL_LENGTH)}`));
    expect(err.code).toBe("TOO_LARGE");
    expect(err.message).toContain(String(MAX_SQL_LENGTH));
  });

  it("accepts SQL of exactly MAX_SQL_LENGTH characters", () => {
    const sql = `SELECT 1${" ".repeat(MAX_SQL_LENGTH - 8)}`;
    expect(sql.length).toBe(MAX_SQL_LENGTH);
    expect(() => checkSql(sql)).not.toThrow();
  });

  it("skips leading line comments terminated by LF or CRLF", () => {
    expect(() => checkSql("-- first\nSELECT 1")).not.toThrow();
    expect(() =>
      checkSql("-- first\r\n-- second\r\nWITH x AS (SELECT 1) SELECT * FROM x"),
    ).not.toThrow();
  });

  it("rejects input that is only a line comment with NOT_READ_ONLY", () => {
    const err = captureError(() => checkSql("-- SELECT 1"));
    expect(err.code).toBe("NOT_READ_ONLY");
  });

  it("rejects an unterminated leading block comment with NOT_READ_ONLY", () => {
    const err = captureError(() => checkSql("/* SELECT 1 *"));
    expect(err.code).toBe("NOT_READ_ONLY");
    expect(err.message).toBe("Unterminated block comment in SQL");
  });

  it("rejects a non read-only keyword hidden after comments", () => {
    const err = captureError(() => checkSql("/* a */ -- b\n DELETE FROM t"));
    expect(err.code).toBe("NOT_READ_ONLY");
    expect(err.message).toBe("only single SELECT or WITH statements are allowed");
  });

  it("accepts lowercase keywords followed directly by punctuation", () => {
    expect(() => checkSql("select(1)")).not.toThrow();
    expect(() => checkSql("with")).not.toThrow();
  });
});

describe("ReadonlyDb edge cases", () => {
  it("listTables returns [] for an empty database", async () => {
    const db = await openDatabase(await buildDb(""));
    expect(db.listTables()).toEqual([]);
    db.close();
  });

  it("describeTable reports default values, NOT NULL and primary key flags", async () => {
    const db = await openDatabase(
      await buildDb("CREATE TABLE d (id INTEGER PRIMARY KEY, v TEXT NOT NULL DEFAULT 'z');"),
    );
    expect(db.describeTable("d")).toEqual([
      { cid: 0, name: "id", type: "INTEGER", notnull: false, dflt_value: null, pk: 1 },
      { cid: 1, name: "v", type: "TEXT", notnull: true, dflt_value: "'z'", pk: 0 },
    ]);
    db.close();
  });

  it("close() is idempotent and later calls report SQL_ERROR 'Database has been closed'", async () => {
    const db = await openDatabase(await buildDb(""));
    db.close();
    expect(() => db.close()).not.toThrow();
    const err = captureError(() => db.listTables());
    expect(err.code).toBe("SQL_ERROR");
    expect(err.message).toBe("Database has been closed");
  });

  it("reports a syntax error as SQL_ERROR", async () => {
    const db = await openDatabase(await buildDb(""));
    const err = captureError(() => db.query("SELECT FROM"));
    expect(err.code).toBe("SQL_ERROR");
    expect(err.message).toContain("syntax error");
    db.close();
  });

  it("reports a runtime error during binding as SQL_ERROR", async () => {
    const db = await openDatabase(await buildDb(""));
    const err = captureError(() => db.query("SELECT ?", [1, 2]));
    expect(err.code).toBe("SQL_ERROR");
    db.close();
  });

  it("rejects a non-scalar parameter with INVALID_PARAMS naming its type", async () => {
    const db = await openDatabase(await buildDb(""));
    // @ts-expect-error boolean is not an allowed parameter type
    const err = captureError(() => db.query("SELECT ?", [true]));
    expect(err.code).toBe("INVALID_PARAMS");
    expect(err.message).toBe("Invalid parameter type: boolean");
    db.close();
  });

  it("accepts exactly MAX_PARAMS_COUNT parameters including null", async () => {
    const db = await openDatabase(await buildDb(""));
    const params: (number | null)[] = new Array(100).fill(1);
    params[0] = null;
    const placeholders = params.map(() => "?").join(",");
    const res = db.query(`SELECT ${placeholders}`, params);
    expect(res.rows[0]?.length).toBe(100);
    expect(res.rows[0]?.[0]).toBeNull();
    expect(res.truncated).toBe(false);
    db.close();
  });

  it("accepts trailing semicolons, line comments and block comments after the statement", async () => {
    const db = await openDatabase(await buildDb(""));
    expect(db.query("SELECT 1;;").rows).toEqual([[1]]);
    expect(db.query("SELECT 1;\r\n-- one\r\n/* two */ ;\n-- three").rows).toEqual([[1]]);
    db.close();
  });

  it("fails closed on an unterminated trailing block comment", async () => {
    const db = await openDatabase(await buildDb(""));
    const err = captureError(() => db.query("SELECT 1; /* trailing comment to end of input"));
    expect(err.code).toBe("MULTIPLE_STATEMENTS");
    db.close();
  });

  it("rejects a second statement hidden behind trailing comments with MULTIPLE_STATEMENTS", async () => {
    const db = await openDatabase(
      await buildDb("CREATE TABLE t (id INT); INSERT INTO t VALUES (1);"),
    );
    const err = captureError(() => db.query("SELECT 1; -- c\r\n/* d */ DELETE FROM t"));
    expect(err.code).toBe("MULTIPLE_STATEMENTS");
    expect(err.message).toBe("Multiple SQL statements detected");
    expect(db.query("SELECT count(*) FROM t").rows).toEqual([[1]]);
    db.close();
  });

  it("reports a WITH ... INSERT as NOT_READ_ONLY and leaves data unchanged", async () => {
    const db = await openDatabase(await buildDb("CREATE TABLE t (id INT);"));
    const err = captureError(() => db.query("WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x"));
    expect(err.code).toBe("NOT_READ_ONLY");
    expect(db.query("SELECT count(*) FROM t").rows).toEqual([[0]]);
    db.close();
  });

  it("returns an empty result with columns for a query matching no rows", async () => {
    const db = await openDatabase(await buildDb("CREATE TABLE t (id INT, name TEXT);"));
    expect(db.query("SELECT id, name FROM t")).toEqual({
      columns: ["id", "name"],
      rows: [],
      truncated: false,
    });
    db.close();
  });

  it("is not truncated when the row count equals maxRows", async () => {
    const db = await openDatabase(
      await buildDb("CREATE TABLE t (id INT); INSERT INTO t VALUES (1), (2);"),
    );
    const res = db.query("SELECT id FROM t ORDER BY id", [], { maxRows: 2 });
    expect(res).toEqual({ columns: ["id"], rows: [[1], [2]], truncated: false });
    const zero = db.query("SELECT id FROM t", [], { maxRows: 0 });
    expect(zero).toEqual({ columns: ["id"], rows: [], truncated: true });
    db.close();
  });

  it("keeps text at maxCellChars unchanged and returns numbers, nulls and empty blobs as-is", async () => {
    const db = await openDatabase(
      await buildDb(
        "CREATE TABLE c (t TEXT, r REAL, n INT, b BLOB); INSERT INTO c VALUES ('abc', 1.5, NULL, x'');",
      ),
    );
    const res = db.query("SELECT t, r, n, b FROM c", [], { maxCellChars: 3 });
    expect(res.rows).toEqual([["abc", 1.5, null, { $blob: "" }]]);
    const cut = db.query("SELECT t FROM c", [], { maxCellChars: 2 });
    expect(cut.rows).toEqual([["ab"]]);
    db.close();
  });

  it("stops before the row that would exceed maxResultBytes", async () => {
    const db = await openDatabase(
      await buildDb("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('aaaa'), ('bbbb'), ('cccc');"),
    );
    // columns '["v"]' = 5 bytes; each row '["aaaa"]' + 2 = 10 bytes.
    const res = db.query("SELECT v FROM t ORDER BY v", [], { maxResultBytes: 25 });
    expect(res).toEqual({ columns: ["v"], rows: [["aaaa"], ["bbbb"]], truncated: true });
    db.close();
  });
});

describe("openDatabase edge cases", () => {
  it("accepts a database whose size equals maxDbBytes", async () => {
    const bytes = await buildDb("CREATE TABLE t (id INT);");
    const db = await openDatabase(bytes, { maxDbBytes: bytes.byteLength });
    expect(db.listTables()).toEqual(["t"]);
    db.close();
  });

  it("reports TOO_LARGE with both sizes in the message", async () => {
    const err = await openDatabase(new Uint8Array(10), { maxDbBytes: 9 }).then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e as SqliteMcpError,
    );
    expect(err).toBeInstanceOf(SqliteMcpError);
    expect(err.code).toBe("TOO_LARGE");
    expect(err.message).toBe("Database size 10 bytes exceeds limit of 9 bytes");
  });

  it("rejects bytes that are not a SQLite database with SQL_ERROR", async () => {
    const garbage = new TextEncoder().encode("this is definitely not a sqlite database file!!");
    await expect(openDatabase(garbage)).rejects.toMatchObject({
      name: "SqliteMcpError",
      code: "SQL_ERROR",
    });
  });
});

describe("CLI failure paths", () => {
  it("returns 1 and reports 'Failed to start server' for a file that is not a SQLite database", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-sqlite-edge-"));
    try {
      const path = join(dir, "bad.sqlite");
      await writeFile(path, "this is definitely not a sqlite database file!!");
      const stderr: string[] = [];
      const stdout: string[] = [];
      const code = await run([path], {
        stdout: (s) => stdout.push(s),
        stderr: (s) => stderr.push(s),
      });
      expect(code).toBe(1);
      expect(stderr.join("")).toContain("Failed to start server");
      expect(stdout).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("McpServer tool handler error paths", () => {
  it("query tool returns JSON results for a valid SELECT with params", async () => {
    const db = await openDatabase(
      await buildDb("CREATE TABLE t (id INT, name TEXT); INSERT INTO t VALUES (1, 'a'), (2, 'b');"),
    );
    const client = await connect(db);
    const res = await client.callTool({
      name: "query",
      arguments: { sql: "SELECT name FROM t WHERE id = ?", params: [2] },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(firstText(res))).toEqual({
      columns: ["name"],
      rows: [["b"]],
      truncated: false,
    });
    await client.close();
    db.close();
  });

  it("query tool maps MULTIPLE_STATEMENTS to an error result", async () => {
    const db = await openDatabase(await buildDb(""));
    const client = await connect(db);
    const res = await client.callTool({ name: "query", arguments: { sql: "SELECT 1; SELECT 2" } });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toBe("MULTIPLE_STATEMENTS: Multiple SQL statements detected");
    await client.close();
    db.close();
  });

  it("list_tables tool returns an SQL_ERROR result after the database is closed", async () => {
    const db = await openDatabase(await buildDb(""));
    const client = await connect(db);
    db.close();
    const res = await client.callTool({ name: "list_tables", arguments: {} });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toBe("SQL_ERROR: Database has been closed");
    await client.close();
  });

  it("maps a plain Error from any handler to SQL_ERROR with its message", async () => {
    const failing: ReadonlyDb = {
      listTables: () => {
        throw new Error("boom list");
      },
      describeTable: () => {
        throw new Error("boom describe");
      },
      query: () => {
        throw new Error("boom query");
      },
      close: () => {},
    };
    const client = await connect(failing);
    const list = await client.callTool({ name: "list_tables", arguments: {} });
    expect(list.isError).toBe(true);
    expect(firstText(list)).toBe("SQL_ERROR: boom list");
    const desc = await client.callTool({ name: "describe_table", arguments: { table: "x" } });
    expect(desc.isError).toBe(true);
    expect(firstText(desc)).toBe("SQL_ERROR: boom describe");
    const query = await client.callTool({ name: "query", arguments: { sql: "SELECT 1" } });
    expect(query.isError).toBe(true);
    expect(firstText(query)).toBe("SQL_ERROR: boom query");
    await client.close();
  });

  it("maps a non-Error thrown value to SQL_ERROR with its string form", async () => {
    const failing: ReadonlyDb = {
      listTables: () => {
        throw "raw list";
      },
      describeTable: () => {
        throw "raw describe";
      },
      query: () => {
        throw "raw query";
      },
      close: () => {},
    };
    const client = await connect(failing);
    const list = await client.callTool({ name: "list_tables", arguments: {} });
    expect(firstText(list)).toBe("SQL_ERROR: raw list");
    const desc = await client.callTool({ name: "describe_table", arguments: { table: "x" } });
    expect(firstText(desc)).toBe("SQL_ERROR: raw describe");
    const query = await client.callTool({ name: "query", arguments: { sql: "SELECT 1" } });
    expect(query.isError).toBe(true);
    expect(firstText(query)).toBe("SQL_ERROR: raw query");
    await client.close();
  });
});
