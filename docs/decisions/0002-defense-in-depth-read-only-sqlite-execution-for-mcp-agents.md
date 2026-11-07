# Defense-in-depth read-only SQLite execution for MCP agents

Status: accepted (generated, pending human review)

## Context

Granting agents access to SQLite databases frequently risks unintended mutations or SQL injection if the server opens files in read-write mode or trusts model queries. A robust design must guarantee read-only behavior regardless of agent prompt output.

## Decision

Load SQLite databases strictly into WebAssembly memory via sql.js, activate PRAGMA query_only = ON, enforce leading SELECT/WITH keyword validation, require single-statement iteration, bind positional parameters without string interpolation, and cap output rows, cell sizes, and serialised byte lengths.

## Consequences

File mutation is impossible as writes are prohibited by both the engine and absent disk persistence; expensive Cartesian queries remain un-interruptible in WebAssembly.
