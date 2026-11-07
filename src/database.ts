import initSqlJs, { type Database as SqlDatabase, type Statement } from "sql.js";
import { SqliteMcpError } from "./errors.js";
import { checkSql } from "./sql-check.js";

export const DEFAULT_MAX_DB_BYTES = 104_857_600; // 100 MiB
export const DEFAULT_MAX_ROWS = 1_000;
export const DEFAULT_MAX_CELL_CHARS = 10_000;
export const DEFAULT_MAX_RESULT_BYTES = 1_048_576; // 1 MiB
export const MAX_PARAMS_COUNT = 100;

/**
 * Represents a binary blob cell serialised for MCP tool output.
 */
export interface BlobCell {
  $blob: string;
}

/**
 * Supported cell values returned by query results.
 */
export type QueryCellValue = string | number | null | BlobCell;

/**
 * Table column schema details from SQLite table_info.
 */
export interface Column {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: number;
}

/**
 * Result of a SELECT query execution.
 */
export interface QueryResult {
  columns: string[];
  rows: QueryCellValue[][];
  truncated: boolean;
}

/**
 * Options for query execution.
 */
export interface QueryOptions {
  maxRows?: number;
  maxCellChars?: number;
  maxResultBytes?: number;
}

/**
 * Options for opening the database.
 */
export interface OpenDatabaseOptions {
  maxDbBytes?: number;
}

/**
 * Read-only SQLite database handle.
 */
export interface ReadonlyDb {
  listTables(): string[];
  describeTable(name: string): Column[];
  query(sql: string, params?: (string | number | null)[], opts?: QueryOptions): QueryResult;
  close(): void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      binary += String.fromCharCode(b);
    }
  }
  return btoa(binary);
}

function isAllWhitespaceOrComments(text: string): boolean {
  let index = 0;
  const len = text.length;
  while (index < len) {
    const ch = text[index];
    if (/\s/.test(ch ?? "")) {
      index += 1;
      continue;
    }
    if (ch === ";") {
      index += 1;
      continue;
    }
    if (ch === "-" && text[index + 1] === "-") {
      index += 2;
      while (index < len && text[index] !== "\n" && text[index] !== "\r") {
        index += 1;
      }
      continue;
    }
    if (ch === "/" && text[index + 1] === "*") {
      index += 2;
      while (index + 1 < len) {
        if (text[index] === "*" && text[index + 1] === "/") {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }
    return false;
  }
  return true;
}

class ReadonlyDbImpl implements ReadonlyDb {
  private readonly db: SqlDatabase;
  private closed = false;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  listTables(): string[] {
    this.assertOpen();
    try {
      const res = this.db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
      );
      if (res.length === 0 || !res[0]) {
        return [];
      }
      return res[0].values.map((row) => String(row[0] ?? ""));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  describeTable(name: string): Column[] {
    this.assertOpen();
    const tables = this.listTables();
    if (!tables.includes(name)) {
      throw new SqliteMcpError("UNKNOWN_TABLE", `Table not found: ${name}`);
    }

    const safeIdent = name.replace(/"/g, '""');
    const pragmaSql = `PRAGMA table_info("${safeIdent}");`;
    try {
      const res = this.db.exec(pragmaSql);
      if (res.length === 0 || !res[0]) {
        return [];
      }
      return res[0].values.map((row) => ({
        cid: Number(row[0]),
        name: String(row[1] ?? ""),
        type: String(row[2] ?? ""),
        notnull: Boolean(row[3]),
        dflt_value: row[4] === null ? null : String(row[4]),
        pk: Number(row[5] ?? 0),
      }));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  query(
    sql: string,
    params: (string | number | null)[] = [],
    opts: QueryOptions = {},
  ): QueryResult {
    this.assertOpen();
    checkSql(sql);

    if (params.length > MAX_PARAMS_COUNT) {
      throw new SqliteMcpError(
        "INVALID_PARAMS",
        `Too many parameters: ${params.length} exceeds max ${MAX_PARAMS_COUNT}`,
      );
    }
    for (const p of params) {
      if (p !== null && typeof p !== "string" && typeof p !== "number") {
        throw new SqliteMcpError("INVALID_PARAMS", `Invalid parameter type: ${typeof p}`);
      }
    }

    let it: ReturnType<SqlDatabase["iterateStatements"]>;
    try {
      it = this.db.iterateStatements(sql);
    } catch (err) {
      throw this.wrapError(err);
    }

    // sql.js StatementIterator follows the iterator protocol, and next() frees the statement it returned before,
    // so take only the first statement and inspect the SQL left after it.
    let primaryStmt: Statement | null = null;
    let remainder: string;
    try {
      const first = it.next();
      primaryStmt = first.done ? null : first.value;
      remainder = it.getRemainingSQL();
    } catch (err) {
      throw this.wrapError(err);
    }

    if (!primaryStmt) {
      throw new SqliteMcpError(
        "NOT_READ_ONLY",
        "only single SELECT or WITH statements are allowed",
      );
    }

    if (!isAllWhitespaceOrComments(remainder)) {
      primaryStmt.free();
      throw new SqliteMcpError("MULTIPLE_STATEMENTS", "Multiple SQL statements detected");
    }

    const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
    const maxCellChars = opts.maxCellChars ?? DEFAULT_MAX_CELL_CHARS;
    const maxResultBytes = opts.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;

    let columns: string[] = [];
    const rows: QueryCellValue[][] = [];
    let truncated = false;
    let estimatedBytes = 0;

    try {
      if (params.length > 0) {
        primaryStmt.bind(params);
      }
      columns = primaryStmt.getColumnNames();
      estimatedBytes += JSON.stringify(columns).length;

      while (primaryStmt.step()) {
        if (rows.length >= maxRows) {
          truncated = true;
          break;
        }

        const rawValues = primaryStmt.get();
        const rowCells: QueryCellValue[] = [];

        for (const cell of rawValues) {
          let processed: QueryCellValue;
          if (cell instanceof Uint8Array) {
            processed = { $blob: bytesToBase64(cell) };
          } else if (typeof cell === "string") {
            processed = cell.length > maxCellChars ? cell.slice(0, maxCellChars) : cell;
          } else {
            processed = cell;
          }
          rowCells.push(processed);
        }

        const rowBytes = JSON.stringify(rowCells).length + 2;
        if (estimatedBytes + rowBytes > maxResultBytes) {
          truncated = true;
          break;
        }

        rows.push(rowCells);
        estimatedBytes += rowBytes;
      }
    } catch (err) {
      throw this.wrapError(err);
    } finally {
      try {
        primaryStmt.free();
      } catch {
        /* ignore */
      }
    }

    return { columns, rows, truncated };
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new SqliteMcpError("SQL_ERROR", "Database has been closed");
    }
  }

  private wrapError(err: unknown): SqliteMcpError {
    if (err instanceof SqliteMcpError) {
      return err;
    }
    const rawMsg = err instanceof Error ? err.message : String(err);
    const lower = rawMsg.toLowerCase();
    if (
      lower.includes("readonly") ||
      lower.includes("read-only") ||
      lower.includes("attempt to write a readonly database")
    ) {
      return new SqliteMcpError("NOT_READ_ONLY", rawMsg);
    }
    return new SqliteMcpError("SQL_ERROR", rawMsg);
  }
}

/**
 * Opens a read-only in-memory SQLite database from raw SQLite file bytes.
 *
 * @param bytes - SQLite database binary file content.
 * @param opts - Configuration options including byte size limits.
 * @returns ReadonlyDb handle.
 * @throws {SqliteMcpError} If bytes exceed maxDbBytes or initialisation fails.
 */
export async function openDatabase(
  bytes: Uint8Array,
  opts: OpenDatabaseOptions = {},
): Promise<ReadonlyDb> {
  const maxDbBytes = opts.maxDbBytes ?? DEFAULT_MAX_DB_BYTES;
  if (bytes.byteLength > maxDbBytes) {
    throw new SqliteMcpError(
      "TOO_LARGE",
      `Database size ${bytes.byteLength} bytes exceeds limit of ${maxDbBytes} bytes`,
    );
  }

  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  try {
    SQL = await initSqlJs();
  } catch (err) {
    throw new SqliteMcpError(
      "SQL_ERROR",
      `Failed to initialize SQLite engine: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let db: SqlDatabase;
  try {
    db = new SQL.Database(bytes);
    db.exec("PRAGMA query_only = ON;");
    // SQLite reads the file lazily; touch the schema so non-database bytes fail here.
    db.exec("SELECT count(*) FROM sqlite_master;");
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    throw new SqliteMcpError("SQL_ERROR", rawMsg);
  }

  return new ReadonlyDbImpl(db);
}
