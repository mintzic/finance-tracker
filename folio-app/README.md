# Folio desktop

Local-first finance tracker built with Tauri 2, React, React Router data routing, and Rust/SQLite. The installed app runs no Electron or Node server.

## Development

Install Node.js, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```sh
npm ci
npm run tauri dev
```

Frontend-only `npm run dev` cannot perform financial operations without Tauri. Hash routes are `/#/` and `/#/settings`. React Router loaders/actions call feature-specific commands registered in `src-tauri/src/commands/mod.rs`; validation and SQL execute in Rust.

## One profile, multiple ledgers

A single profile contains username and language. A new installation creates an editable `You` profile and a `Default` ledger. Create as many ledgers as needed—for example Education and Work—and switch, rename, or delete them in Settings. Every ledger has independent accounts, transactions, budgets, subscriptions, goals, categories, receipts, and header image. Selection persists across restarts. Deletion requires `DELETE`, creates a database backup, and cannot remove the last ledger. Reset clears only the active ledger.

### Currency defaults

Each ledger has its own currency, selected at creation. The default is inferred from OS regional settings (macOS AppleLocale or Windows culture; monetary locale environment settings as fallback). Unknown/unavailable regions default to **USD**. Detection is local: no GPS, network lookup, or location permission. Users can choose a different currency before creating a ledger. Existing ledger currencies are never changed when system settings change; renaming preserves currency. Amounts are not converted between currencies. Amount arithmetic retains the existing fixed two-decimal representation.

## Storage and naming

Under Tauri's application-data directory for `com.mintzic.folio` (macOS: `~/Library/Application Support/com.mintzic.folio`):

```text
folio.sqlite                 # profile, ledgers, app_settings
ledgers/<uuid>.sqlite        # financial records for one ledger
backups/                     # pre-deletion database backups
```

Financial tables include `accounts`, `transactions`, `budgets`, `subscriptions`, `goals`, `contributions`, `categories`, `receipts`, `receipt_files`, and `ledger_cover`. Columns use `account_id`, `destination_account_id`, and `transaction_id` rather than wallet/entry terminology.

`src-tauri/src/storage.rs` owns registry/ledger connections and migration. `commands/profile.rs` manages the one profile; `commands/ledgers.rs` manages ledgers. Feature commands remain directly under `commands/`. The fresh financial schema is `src-tauri/src/schema.sql`.

## Existing installations and Electron import

Back up the whole old data directory while its app is closed before upgrading.

- On startup, the earlier Tauri `finance.sqlite`/`profiles` layout is automatically converted through staged copies into the new layout.
- Each old profile becomes a ledger, retaining its name, currency, and records. The selected old profile supplies the single profile's username/language and selected ledger. An unprofiled legacy finance database becomes a Default ledger.
- Original databases remain untouched; SQLite backup snapshots and converted ledgers are validated before the new registry is published.
- Historical migrations `0001–0008` are unchanged and checksum-verified. `0009_ledger_names.sql` renames financial tables/columns on the copies. Never edit applied migrations.
- Unreferenced legacy profile databases cause an explicit error instead of silently excluding their records.

To import a separate Electron directory, open Settings → Import legacy data **before customizing the default profile/ledger or entering records**. Enter the absolute directory containing `finance.sqlite`, `profiles`, and `receipts`, type `IMPORT`, and submit. The destination must be an unused Default ledger, including unchanged default categories. Sources remain untouched; missing receipts, unsafe paths, or nonempty destinations reject the import. Keep backups until you have verified balances, attachments, and reports in every imported ledger.

## Header images

PNG/JPEG/WebP cover uploads have no 5 MB file-size cap. Binary IPC avoids JSON byte arrays. Rust processes images on a background worker before saving, resizing without upscaling to fit **2560 × 1440** and stripping metadata. Output is JPEG quality 85, or PNG for an alpha channel. Only optimized bytes are stored; failures retain the current header. An in-flight upload remains bound to its initiating ledger.

Large inputs, including files over 100 MB, still need upload memory/time. Decoding is guarded by 32,768 pixels per axis, 100 million total pixels, and a 512 MiB decoder allocation budget—not a process-wide memory cap. Existing images are optimized only when re-uploaded. CSV uploads and pasted CSV have no application-imposed file-size cap. The existing 1,000-row import batch and 10,000-character record limits remain. Large CSVs still require frontend IPC memory and backend processing time.

## Receipts

PDF, PNG, and JPEG receipts have no application-imposed upload-size cap (available memory and database limits still apply). Clicking an attachment opens a popup preview with an option to download the unchanged original. Image previews are generated on a backend worker using the bounded image optimizer above and returned over binary IPC; PDFs use the webview’s built-in viewer, with a download fallback. Previews load only when opened and their temporary URLs are released on close. Receipt uploads still use JSON IPC, so very large files can require significant memory and upload time.

## Validation and packaging

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build
```

Release signing requires platform-specific credentials. Native UI, file downloads, and packaging should be smoke-tested on each target OS. `mobile-app` and `server` are outside this migration.
