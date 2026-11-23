//! The door for AI agents: an MCP server that reads and writes formulas in open documents.
//!
//! Owns: permissions, the audit log, the mapping from an agent's request to a `sessions` request.
//! Limits: no Office logic; it offers what the add-ins already do.
