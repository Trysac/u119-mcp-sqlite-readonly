import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { checkSql, openDatabase, SqliteMcpError } from "../src/index.js";

describe("Security and Threat Model Defenses", () => {
  it("Defended 1: writes or schema changes never reach underlying store", async () => {
    const SQL = await initSqlJs();
    const mem = new SQL.Database();
    mem.exec("CREATE TABLE items (id INT, val TEXT); INSERT INTO items VALUES (1, 'orig');");
    const bytes = mem.export();
    mem.close();

    const db = await openDatabase(bytes);
    expect(() => db.query("UPDATE items SET val = 'hacked'")).toThrowError(SqliteMcpError);
    expect(() => db.query("INSERT INTO items VALUES (2, 'evil')")).toThrowError(SqliteMcpError);
    expect(() => db.query("CREATE TABLE evil (id INT)")).toThrowError(SqliteMcpError);
    expect(() => db.query("ALTER TABLE items ADD COLUMN evil TEXT")).toThrowError(SqliteMcpError);

    const check = db.query("SELECT * FROM items");
    expect(check.rows).toEqual([[1, "orig"]]);
    db.close();
  });

  it("Defended 2: multiple statements are blocked", async () => {
    const SQL = await initSqlJs();
    const mem = new SQL.Database();
    mem.exec("CREATE TABLE t (id INT);");
    const bytes = mem.export();
    mem.close();

    const db = await openDatabase(bytes);
    expect(() => db.query("SELECT 1; SELECT 2;")).toThrowError(SqliteMcpError);
    expect(() => db.query("SELECT 1; DROP TABLE t;")).toThrowError(SqliteMcpError);
    db.close();
  });

  it("Defended 3: ATTACH, PRAGMA, and non-query statements are blocked", async () => {
    const SQL = await initSqlJs();
    const mem = new SQL.Database();
    const bytes = mem.export();
    mem.close();

    const db = await openDatabase(bytes);
    expect(() => db.query("ATTACH DATABASE 'other.db' AS other")).toThrowError(SqliteMcpError);
    expect(() => db.query("PRAGMA compile_options")).toThrowError(SqliteMcpError);
    expect(() => db.query("DETACH DATABASE other")).toThrowError(SqliteMcpError);
    expect(() => db.query("REINDEX")).toThrowError(SqliteMcpError);
    db.close();
  });

  it("Defended 4: SQL injection through parameters is neutralized", async () => {
    const SQL = await initSqlJs();
    const mem = new SQL.Database();
    mem.exec("CREATE TABLE secrets (id INT, secret TEXT); INSERT INTO secrets VALUES (1, 'safe');");
    const bytes = mem.export();
    mem.close();

    const db = await openDatabase(bytes);
    const result = db.query("SELECT secret FROM secrets WHERE secret = ?", ["' OR '1'='1"]);
    expect(result.rows.length).toBe(0);
    db.close();
  });

  it("Defended 5: unbounded result size is capped", async () => {
    const SQL = await initSqlJs();
    const mem = new SQL.Database();
    mem.exec(`
      CREATE TABLE bigtext (col TEXT);
      INSERT INTO bigtext VALUES ('${"A".repeat(50_000)}');
    `);
    const bytes = mem.export();
    mem.close();

    const db = await openDatabase(bytes);
    const cappedCell = db.query("SELECT col FROM bigtext", [], { maxCellChars: 100 });
    const firstCell = cappedCell.rows[0]?.[0];
    expect(typeof firstCell).toBe("string");
    expect((firstCell as string).length).toBe(100);

    const cappedBytes = db.query("SELECT col FROM bigtext", [], {
      maxResultBytes: 200,
      maxCellChars: 50_000,
    });
    expect(cappedBytes.truncated).toBe(true);
    db.close();
  });

  it("handles checkSql adversarial neighbour cases and comment edges", () => {
    expect(() => checkSql("")).toThrowError(SqliteMcpError);
    expect(() => checkSql("/* unclosed")).toThrowError(SqliteMcpError);
    expect(() => checkSql("SELECT1 FROM t")).toThrowError(SqliteMcpError);
    expect(() => checkSql(`${" ".repeat(1000)}SELECT 1`)).not.toThrow();
  });
});
