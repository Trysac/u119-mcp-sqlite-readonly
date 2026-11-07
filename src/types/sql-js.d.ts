declare module "sql.js" {
  export interface QueryExecResult {
    columns: string[];
    values: (string | number | null | Uint8Array)[][];
  }

  // Matches sql.js 1.x: an iterator over the statements of a SQL string (getRemainingSQL is the unparsed rest).
  export interface StatementIterator extends Iterator<Statement> {
    getRemainingSQL(): string;
  }

  export interface Statement {
    bind(
      values?:
        | (string | number | null | Uint8Array)[]
        | Record<string, string | number | null | Uint8Array>,
    ): boolean;
    step(): boolean;
    get(params?: (string | number | null | Uint8Array)[]): (string | number | null | Uint8Array)[];
    getColumnNames(): string[];
    free(): boolean;
  }

  export interface Database {
    exec(sql: string, params?: (string | number | null | Uint8Array)[]): QueryExecResult[];
    prepare(sql: string, params?: (string | number | null | Uint8Array)[]): Statement;
    iterateStatements(sql: string): StatementIterator;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | number[]) => Database;
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
