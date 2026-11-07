/**
 * Public entry point of @trysac/mcp-sqlite-readonly.
 */

export {
  type BlobCell,
  type Column,
  DEFAULT_MAX_CELL_CHARS,
  DEFAULT_MAX_DB_BYTES,
  DEFAULT_MAX_RESULT_BYTES,
  DEFAULT_MAX_ROWS,
  MAX_PARAMS_COUNT,
  type OpenDatabaseOptions,
  openDatabase,
  type QueryCellValue,
  type QueryOptions,
  type QueryResult,
  type ReadonlyDb,
} from "./database.js";
export { SqliteMcpError, type SqliteMcpErrorCode } from "./errors.js";
export { type CreateServerOptions, createServer } from "./server.js";
export { checkSql, MAX_SQL_LENGTH } from "./sql-check.js";
