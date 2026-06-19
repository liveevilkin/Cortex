# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Cortex, please **do not** open a public issue.

Instead, report it privately by:

1. **GitHub Security Advisories**: Use the "Report a vulnerability" button on the [Security tab](https://github.com/liveevilkin/Cortex/security)
2. **Email**: If you know the maintainer's email, send an encrypted report

You can expect:

- Acknowledgment within 48 hours
- Regular updates on progress
- Credit in the advisory (unless you prefer anonymity)

## Security Considerations

Cortex is a **local-only** memory system:

- **No network exposure** — MCP server runs via stdio transport on localhost only
- **No API keys stored** — Embedding model runs locally via ONNX
- **File system access** — Reads/writes only within configured Obsidian vault paths
- **SQLite injection** — All queries use parameterized statements (`?` placeholders)
- **Input validation** — All MCP tool parameters validated via Zod schemas

## Known Limitations

- The embedding model (`all-MiniLM-L6-v2`) is downloaded from `hf-mirror.com`. If you use a different mirror, verify its trustworthiness.
- The Obsidian vault is read as plain markdown files. Sensitive data in the vault is readable by the MCP server.
- LanceDB string filters use parameterized delete but query strings in some code paths use manual escaping. See `src/db/lancedb.ts`.
