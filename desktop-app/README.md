# Folio desktop

Local-first finance tracker built with Tauri 2, React, React Router data routing, and Rust/SQLite. No Electron or Node server runs inside the installed application.

## Development

Install Node.js, Rust, and the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```sh
npm ci
npm run tauri dev
```

`npm run dev` alone serves the frontend, but financial operations require the Tauri runtime. Routes use hash navigation (`/#/`, `/#/profiles`) with the original dashboard query parameters. Route loaders/actions call typed, feature-specific Tauri commands; financial validation and SQL execute in Rust. Feature implementations live directly in `src-tauri/src/commands/` (accounts, transactions, budgets, categories, subscriptions, goals, profiles, imports, files, overview, and maintenance). `commands/mod.rs::handler()` registers every command with `tauri::generate_handler!`. There is no separate `finance/` directory or generic native mutation endpoint. Shared validation/transaction helpers live in `commands/shared.rs`, and database/profile persistence stays in `src-tauri/src/workspace.rs`.

## Checks and packaging

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build
```

Packaging/signing for distribution may require platform signing credentials. The existing lint configuration references `@stylistic/eslint-plugin` and `typescript-eslint`, which are not currently declared in package.json; `npm run lint` cannot run until that pre-existing tooling configuration is completed.

## Storage and profiles

Data lives under Tauri's application-data directory for `com.mintzic.folio` (on macOS, `~/Library/Application Support/com.mintzic.folio`). The registry/legacy workspace is `finance.sqlite`; other profiles use `profiles/<uuid>.sqlite`. Active profile selection persists across restarts. Display currency changes relabel amounts, not exchange rates.

The original eight SQL migrations are embedded with matching SHA-256 checksums. Receipts are stored transactionally in SQLite's `native_files` table; covers retain the original blob schema. Never edit migration files after they have been applied. Back up the whole application-data directory while Folio is closed.

## Importing Electron data

1. Quit the old Electron app and make your own backup of its entire data directory.
2. Start a fresh Folio installation. Before creating a profile, use **Import your Electron workspace** on the welcome/profiles screen.
3. Enter the absolute directory containing the old `finance.sqlite`, `profiles` directory (if present), and `receipts` directory.
4. Type `IMPORT` and submit. Folio makes SQLite backup copies, validates migrations/relationships, and imports receipt bytes. It does not modify the source files.
5. Select an imported profile (or create the first profile for an older unprofiled workspace), then verify your accounts, balances, attachments, and reports before retiring the old app.

Import is deliberately rejected when the destination already contains profiles or financial records. Missing receipt files or unsafe paths fail the import rather than silently losing attachments. Keep both the original backup and imported backup copies until verification is complete.

## Migration boundaries

The desktop UI and finance operations were ported from the Electron app. `mobile-app` and `server` are not part of this migration. Browser HTTP resource endpoints were replaced with native commands and Blob-based display/download handling. Native UI, file downloads, and platform-specific packaging should be smoke-tested on each target OS before distribution.
