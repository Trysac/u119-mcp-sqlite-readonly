/**
 * Error codes emitted by the SQLite MCP read-only library.
 */
export type SqliteMcpErrorCode =
  | "NOT_READ_ONLY"
  | "MULTIPLE_STATEMENTS"
  | "SQL_ERROR"
  | "UNKNOWN_TABLE"
  | "TOO_LARGE"
  | "INVALID_PARAMS";

/**
 * Base error class for all domain errors raised by mcp-sqlite-readonly.
 */
export class SqliteMcpError extends Error {
  readonly code: SqliteMcpErrorCode;

  constructor(code: SqliteMcpErrorCode, message: string) {
    const safeMessage = message.length > 200 ? `${message.slice(0, 197)}...` : message;
    super(safeMessage);
    this.name = "SqliteMcpError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
