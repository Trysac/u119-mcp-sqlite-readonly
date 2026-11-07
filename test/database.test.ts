import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { openDatabase, SqliteMcpError } from "../src/index.js";

async function createFixtureDb(): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, bin BLOB);
    INSERT INTO t VALUES (1, 'a', x'0102');
    INSERT INTO t VALUES (2, 'b', NULL);
    INSERT INTO t VALUES (3, 'c', NULL);
    CREATE TABLE "we""ird" (col1 TEXT);
    INSERT INTO "we""ird" VALUES ('val');
  `);
  const data = db.export();
  db.close();
  return data;
}

describe("ReadonlyDb and query execution", () => {
  it("db.query('SELECT id, name FROM t ORDER BY id') returns { columns: ['id', 'name'], rows: [[1, 'a'], [2, 'b']], truncated: false }", async () => {
    const bytes = await createFixtureDb();
    const db = await openDatabase(bytes);

    const res = db.query("SELECT id, name FROM t WHERE id <= 2 ORDER BY id");
    expect(res).toEqual({
      columns: ["id", "name"],
      rows: [
        [1, "a"],
        [2, "b"],
      ],
      truncated: false,
    });
    db.close();
  });

  it("db.query('DELETE FROM t') throws SqliteMcpError with code 'NOT_READ_ONLY', and 'WITH x AS (SELECT 1) DELETE FROM t' also throws 'NOT_READ_ONLY' (refused by PRAGMA query_only) after which SELECT count(*) FROM t still returns 2", async () => {
    const SQL = await initSqlJs();
    const base = new SQL.Database();
    base.exec(`
      CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO t VALUES (1, 'a');
      INSERT INTO t VALUES (2, 'b');
    `);
    const bytes = base.export();
    base.close();

    const db = await openDatabase(bytes);

    expect(() => db.query("DELETE FROM t")).toThrowError(SqliteMcpError);
    try {
      db.query("DELETE FROM t");
    } catch (e: unknown) {
      const err = e as SqliteMcpError;
      expect(err.code).toBe("NOT_READ_ONLY");
    }

    expect(() => db.query("WITH x AS (SELECT 1) DELETE FROM t")).toThrowError(SqliteMcpError);
    try {
      db.query("WITH x AS (SELECT 1) DELETE FROM t");
    } catch (e: unknown) {
      const err = e as SqliteMcpError;
      expect(err.code).toBe("NOT_READ_ONLY");
    }

    const countRes = db.query("SELECT count(*) FROM t");
    expect(countRes.rows[0]?.[0]).toBe(2);
    db.close();
  });

  it("'SELECT 1; SELECT 2' throws code 'MULTIPLE_STATEMENTS' while 'SELECT 1; -- done' and '/* c */ select 1' succeed", async () => {
    const bytes = await createFixtureDb();
    const db = await openDatabase(bytes);

    try {
      db.query("SELECT 1; SELECT 2");
      expect.fail("Should have thrown");
    } catch (e: unknown) {
      const err = e as SqliteMcpError;
      expect(err.code).toBe("MULTIPLE_STATEMENTS");
    }

    const res1 = db.query("SELECT 1; -- done");
    expect(res1.rows).toEqual([[1]]);

    const res2 = db.query("/* c */ select 1");
    expect(res2.rows).toEqual([[1]]);

    db.close();
  });

  it("'ATTACH DATABASE ? AS x', 'PRAGMA query_only = OFF' and 'VACUUM' throw code 'NOT_READ_ONLY'", async () => {
    const bytes = await createFixtureDb();
    const db = await openDatabase(bytes);

    expect(() => db.query("ATTACH DATABASE ? AS x")).toThrowError(SqliteMcpError);
    try {
      db.query("ATTACH DATABASE ? AS x");
    } catch (e) {
      expect((e as SqliteMcpError).code).toBe("NOT_READ_ONLY");
    }

    expect(() => db.query("PRAGMA query_only = OFF")).toThrowError(SqliteMcpError);
    try {
      db.query("PRAGMA query_only = OFF");
    } catch (e) {
      expect((e as SqliteMcpError).code).toBe("NOT_READ_ONLY");
    }

    expect(() => db.query("VACUUM")).toThrowError(SqliteMcpError);
    try {
      db.query("VACUUM");
    } catch (e) {
      expect((e as SqliteMcpError).code).toBe("NOT_READ_ONLY");
    }

    db.close();
  });

  it("With maxRows 2 a three-row result returns 2 rows and truncated true, a 10_001-character text cell is cut to 10_000 characters, and a BLOB of bytes [1, 2] is returned as { $blob: 'AQI=' }", async () => {
    const SQL = await initSqlJs();
    const base = new SQL.Database();
    base.exec(`
      CREATE TABLE big (txt TEXT, bin BLOB);
      INSERT INTO big VALUES ('${"x".repeat(10_001)}', x'0102');
      INSERT INTO big VALUES ('row2', NULL);
      INSERT INTO big VALUES ('row3', NULL);
    `);
    const bytes = base.export();
    base.close();

    const db = await openDatabase(bytes);

    const resTrunc = db.query("SELECT txt, bin FROM big", [], { maxRows: 2 });
    expect(resTrunc.rows.length).toBe(2);
    expect(resTrunc.truncated).toBe(true);

    const firstRowTxt = resTrunc.rows[0]?.[0];
    expect(typeof firstRowTxt).toBe("string");
    expect((firstRowTxt as string).length).toBe(10_000);

    const firstRowBin = resTrunc.rows[0]?.[1];
    expect(firstRowBin).toEqual({ $blob: "AQI=" });

    db.close();
  });

  it("db.query('SELECT * FROM t WHERE name = ?', ['a']) returns one row, and the parameter \"a' OR '1'='1\" returns zero rows", async () => {
    const bytes = await createFixtureDb();
    const db = await openDatabase(bytes);

    const r1 = db.query("SELECT * FROM t WHERE name = ?", ["a"]);
    expect(r1.rows.length).toBe(1);

    const r2 = db.query("SELECT * FROM t WHERE name = ?", ["a' OR '1'='1"]);
    expect(r2.rows.length).toBe(0);

    db.close();
  });

  it("describeTable('nope') throws code 'UNKNOWN_TABLE', a table named 'we\"ird' is described correctly, openDatabase with more than maxDbBytes 104_857_600 bytes throws 'TOO_LARGE'", async () => {
    const bytes = await createFixtureDb();
    const db = await openDatabase(bytes);

    try {
      db.describeTable("nope");
      expect.fail("Should have thrown");
    } catch (e: unknown) {
      const err = e as SqliteMcpError;
      expect(err.code).toBe("UNKNOWN_TABLE");
    }

    const desc = db.describeTable('we"ird');
    expect(desc.length).toBe(1);
    expect(desc[0]?.name).toBe("col1");
    expect(desc[0]?.type).toBe("TEXT");

    db.close();

    const dummyBytes = new Uint8Array(100);
    await expect(openDatabase(dummyBytes, { maxDbBytes: 50 })).rejects.toThrowError(SqliteMcpError);
    try {
      await openDatabase(dummyBytes, { maxDbBytes: 50 });
    } catch (e: unknown) {
      const err = e as SqliteMcpError;
      expect(err.code).toBe("TOO_LARGE");
    }
  });

  it("validates parameter count and types", async () => {
    const bytes = await createFixtureDb();
    const db = await openDatabase(bytes);

    const manyParams = new Array(101).fill(1);
    expect(() => db.query("SELECT 1", manyParams)).toThrowError(SqliteMcpError);
    try {
      db.query("SELECT 1", manyParams);
    } catch (e) {
      expect((e as SqliteMcpError).code).toBe("INVALID_PARAMS");
    }

    // @ts-expect-error invalid param type
    expect(() => db.query("SELECT 1", [{ not: "scalar" }])).toThrowError(SqliteMcpError);

    // maxResultBytes truncation
    const resMaxBytes = db.query("SELECT name FROM t", [], { maxResultBytes: 20 });
    expect(resMaxBytes.truncated).toBe(true);

    // Database closed checks
    db.close();
    expect(() => db.query("SELECT 1")).toThrowError(SqliteMcpError);
    expect(() => db.listTables()).toThrowError(SqliteMcpError);
    expect(() => db.describeTable("t")).toThrowError(SqliteMcpError);
  });
});
