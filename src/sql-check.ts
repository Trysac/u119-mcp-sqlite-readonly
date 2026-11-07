import { SqliteMcpError } from "./errors.js";

/**
 * Maximum length for checked SQL strings to prevent unbounded parsing overhead.
 */
export const MAX_SQL_LENGTH = 65_536;

/**
 * Validates that an untrusted SQL query begins with a read-only keyword (SELECT or WITH)
 * after stripping leading whitespace and comments.
 *
 * @param sql - Untrusted SQL string.
 * @throws {SqliteMcpError} If sql is too large or does not start with SELECT or WITH.
 */
export function checkSql(sql: string): void {
  if (sql.length > MAX_SQL_LENGTH) {
    throw new SqliteMcpError(
      "TOO_LARGE",
      `SQL query length ${sql.length} exceeds limit ${MAX_SQL_LENGTH}`,
    );
  }

  let index = 0;
  const len = sql.length;

  while (index < len) {
    const char = sql[index];

    if (/\s/.test(char ?? "")) {
      index += 1;
      continue;
    }

    // Line comment -- ...
    if (char === "-" && sql[index + 1] === "-") {
      index += 2;
      while (index < len && sql[index] !== "\n" && sql[index] !== "\r") {
        index += 1;
      }
      continue;
    }

    // Block comment /* ... */
    if (char === "/" && sql[index + 1] === "*") {
      index += 2;
      let closed = false;
      while (index + 1 < len) {
        if (sql[index] === "*" && sql[index + 1] === "/") {
          index += 2;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) {
        throw new SqliteMcpError("NOT_READ_ONLY", "Unterminated block comment in SQL");
      }
      continue;
    }

    break;
  }

  const remainder = sql.slice(index);
  const match = remainder.match(/^([a-zA-Z]+)(?=[^a-zA-Z0-9_$]|$)/); // 'SELECT1' is not SELECT;
  if (!match) {
    throw new SqliteMcpError("NOT_READ_ONLY", "only single SELECT or WITH statements are allowed");
  }

  const keyword = match[1]?.toUpperCase();
  if (keyword !== "SELECT" && keyword !== "WITH") {
    throw new SqliteMcpError("NOT_READ_ONLY", "only single SELECT or WITH statements are allowed");
  }
}
