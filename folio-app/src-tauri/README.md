# Native finance commands

Feature implementations live under `src/commands/`. There is no production
`mutate` or `profile_action` IPC command and no runtime mutation-intent dispatcher.
`commands/mod.rs::handler()` centrally registers all commands. This README lives
at `src-tauri/README.md`.

## Layout and lifecycle

- `accounts.rs`, `transactions.rs`, `budgets.rs`, `categories.rs`,
  `subscriptions.rs`, and `goals.rs` own feature operations and IPC entry points.
- `files.rs` owns receipt storage, assets, and separate cover operations.
- `imports.rs` owns CSV preview/commit/export and the legacy import entry point.
- `overview.rs` owns dashboard queries and billing snapshots.
- `maintenance.rs` owns reset and fictional demo data.
- `profile.rs` updates the global profile; `ledgers.rs` exposes settings and ledger lifecycle commands.
- `shared.rs` owns validation, schema initialization, SQL utilities, state locking,
  and the callback-based immediate transaction helper.
- `ledger.rs` shares transaction validation/writes, balance calculations, and anchored
  subscription billing. `src/schema.sql` supplies the fresh database schema.

`src/storage.rs` owns ledger routing, migrations, backups, legacy copying,
and opening connections. It calls `commands::shared::initialize` after migration.
Initialization is idempotent and enables foreign keys outside a transaction;
existing legacy databases must already have migrations 0001–0009 applied. Records
are not reset or reseeded. Each connection represents one selected ledger.

Cover optimization uses `image` 0.25 with default features disabled and only
PNG, JPEG, and WebP codecs enabled.

## IPC contract

Argument names below are Tauri argument-object keys; managed state is injected.

| Command                                                            | Arguments                |
| ------------------------------------------------------------------ | ------------------------ |
| `dashboard`                                                        | `params`                 |
| `settings`                                                         | none                     |
| `update_profile`                                                   | `form`                   |
| `create_ledger`, `update_ledger`, `switch_ledger`, `delete_ledger` | `form`                   |
| `save_account`, `adjust_account`, `delete_account`                 | `form`                   |
| `save_transaction`, `delete_transaction`                           | `form`                   |
| `save_budget`, `delete_budget`                                     | `form`                   |
| `save_category`, `delete_category`                                 | `form`                   |
| `save_subscription`, `save_goal`                                   | `form`                   |
| `add_contribution`, `delete_contribution`                          | `form`                   |
| `preview_import`, `commit_import`                                  | `form`                   |
| `upload_cover`                                                     | raw binary request body  |
| `remove_cover`, `position_cover`                                   | `form`                   |
| `reset_ledger`, `seed_demo`                                        | `form`                   |
| `asset`                                                            | `kind`, `id`             |
| `export_csv`                                                       | none                     |
| `import_legacy`                                                    | `source`, `confirmation` |

Forms retain the existing feature field names. An `intent` field is unnecessary
and ignored: the command binds a fixed operation callback. In particular, preview
cannot commit, cover upload cannot remove, and profile update cannot create or
switch based on a supplied intent. `update_profile` updates the selected profile.
Settings returns `{profile: {id, username, language}, ledger: {id, name, currency}, ledgers, defaultCurrency}`. Ledger deletion may also return a `warning` if post-commit file cleanup failed; logical deletion still succeeded. Ledger lifecycle forms are validated by `Storage`. New ledger currency defaults to the locally detected system regional currency, falling back to USD. Existing currencies are preserved. Registry tables `profile`, `ledgers`, and `app_settings` live in `folio.sqlite`; financial databases live in `ledgers/<uuid>.sqlite`.

Dashboard parameters are `month`, `view`, `q`, `account`, `category`, `page`, `sort`,
`dir`, and `edit`. Fields are strings (`page` also accepts a number). Return keys,
SQL row field names, integer minor-unit amounts, filters, sorting fallbacks,
20-row pagination, recent lists, six-month trends, recurring budgets, and
end-of-month balances preserve the legacy dashboard contract. Missing edits omit
`edit`; `cover` is null or `{version, position}`. `profile`, `ledger`, and `ledgers` metadata is attached by
the dashboard command. The account list is `accounts`; transaction and subscription
rows use `account_id`, `destination_account_id`, and receipt `transaction_id`.

Form fields are strings, with checkbox values `"on"`. Decimal amounts are parsed
with integer arithmetic; returned amounts are integer minor units. Errors are
`Err(String)`; writes return `{message}` or import `{preview,csv,message}` objects.
Mutations use immediate transactions, including receipt bytes and metadata.
Dashboard billing and snapshots share an immediate transaction. Export bills due
subscriptions in a savepoint before reading the ledger. Today uses Singapore time.
Display currency comes from the ledger registry, not currency conversion.
The retained account currency column defaults to USD without an SGD-only constraint;
it is not authoritative for display. Language belongs to the global profile.

Account deletion preserves the existing archive policy (`policy: "keep"`) or
requires `policy: "delete"` and `confirmation: "DELETE"`. Reset requires
`confirmation: "RESET"`; legacy copying requires `confirmation: "IMPORT"` and
leaves source files untouched. Demo data requires an empty ledger.

## Files and CSV

Receipt/CSV uploads use `{ "name": "invoice.pdf", "mime": "application/pdf", "bytes": [37,80,68,70,45] }`
in `receipt` or `file`. Bytes must be integers from 0–255. Limits are
5 MiB for receipts and 1 MiB for CSV. Imports accept 1–1,000 records and
10,000 content bytes per record. CSV accepts UTF-8 BOM, quoted/multiline fields,
and reordered/extra columns; all eight legacy headers are required:
`date,kind,description,amount,account,destination,category,notes`. Preview
never saves transactions. Duplicate detection covers existing manual transactions and
within-batch duplicates; commit rejects invalid batches atomically. Export quotes
every data cell and protects spreadsheet formula cells.

Receipt MIME is detected from magic bytes, not supplied MIME/extension.
Receipts support PDF/PNG/JPEG.

Cover upload uses `invoke('upload_cover', uint8Array)` with a raw `Uint8Array`
body, **not** `{form}` or a JSON byte array. The async command copies the raw
body and captures the initiating ledger ID under a brief storage mutex lock.
Decoding, resizing, and encoding run in `spawn_blocking` without the global lock.
The task then reacquires the mutex, opens a fresh connection, and holds the lock
through the database transaction, serializing with backup/restore. If the selected
ledger changed during decoding, the upload fails with a retry message instead of
writing to a different ledger. JSON requests
are rejected. The test-only `upload_cover_operation` accepts the historical
`cover.bytes` form and shares the same optimizer.

Covers support PNG/JPEG/WebP, detected from content and decoded for validation.
There is no compressed-input byte cap (including inputs larger than 100 MiB);
the incoming body still occupies memory and is copied for the blocking task.
Decoder limits are 32,768 pixels per axis, 100 million total pixels, and a
512 MiB decoder allocation budget. This budget is not a process-wide memory cap:
input buffers, resized images, and encoded output also consume memory.
Images are downscaled without upscaling, preserving aspect ratio to fit within
2560 × 1440. Images with an alpha channel are re-encoded as PNG; others as JPEG
at quality 85. Re-encoding strips source metadata and trailing input data.
Only optimized bytes and their output MIME are stored. A single transactional
replacement updates bytes, version, and position (reset to 50); decode, encode,
or database failures leave the previous cover intact. Other cover commands keep
their form contract.

Native receipt blobs
cascade with metadata deletion; replacement, account deletion, and reset cannot
orphan them. Cover bytes remain in `ledger_cover.image`. Filenames are sanitized
and never used as filesystem paths. Asset serving does not access the filesystem.

`asset` with `kind: "receipt"` takes a receipt metadata ID; `kind: "cover"` takes
the current version (or `"1"` for the current cover). It returns
`{bytes, mime, filename}`. Unknown kinds and missing/stale IDs error. Cover
positioning requires the current `version`. Legacy external receipt files are
served only after legacy import copies their bytes into native storage.

## Full backup/restore and viewing exports

Registered by `commands::handler()` installed in `lib.rs`:

- `export_backup() -> Result<serde_json::Value, String>`
- `restore_backup(backup: Value, confirmation: String) -> Result<Value, String>`;
  confirmation must be exactly `RESTORE`. Success returns `{message, warning}`.
- `export_table_csv(table: String) -> Result<String, String>`; exact allowlist:
  `transactions`, `accounts`, `categories`, `budgets`, `subscriptions`, `goals`,
  `contributions`. This exports the active ledger only. Existing `export_csv`
  remains unchanged for compatibility.

Backup v1 is `{format: "folio-full-backup", version: 1, registry: number[],
ledgers: [{id: UUID, database: number[]}]}`. Byte arrays contain SQLite backup-API
snapshots, not live file copies. Registry includes profile, all ledger metadata,
and app settings; each ledger includes every table/record, receipt bytes and
cover bytes/position. No billing or other business mutations are run by export.
Frontend localStorage is excluded; the frontend owns its envelope and WebCrypto
encryption. Backend backup payloads and local recovery copies are **unencrypted**.

Limits: **128 MiB compact serialized backend JSON**, **32 MiB per SQLite
snapshot**, **1–256 ledgers**. JSON arrays substantially expand binary size and
parsed JSON consumes additional memory. Frontend should enforce the backend
payload limit before IPC, plus separate bounds for its encryption/localStorage
envelope; the backend cannot prevent Tauri from initially parsing an oversized
request. Encryption overhead is outside the backend payload limit.

Restore stages and validates everything before changing live files: exact
current trusted SQLite schema (including indexes/triggers; no extra executable
schema objects), exact migration names/checksums, integrity/foreign keys,
canonical UUIDs, registry relationships, complete ledger set, receipt presence
and size, header/version/size limits. Unknown manifest fields are rejected.
Only backend-generated paths are used. Older/future or manually customized
schemas are deliberately rejected rather than migrated or executed. Legacy
external receipt/cover source files and historical/deleted database backups are
not active data and are not included; imported assets already live in BLOBs.

Application commands serialize through the storage mutex, including cover
writes. This consistency guarantee does not cover external SQLite writers or
multiple application processes. Before replacement, restore writes and syncs
`recovery-<uuid>/backup.json`, then retains original databases and sidecars in
`recovery-<uuid>/originals`. A failed swap/post-install check rolls back; rollback
failure reports the recovery location. Recovery artifacts are intentionally not
automatically deleted. Keep sufficient disk space for staging and recovery.
The multi-file rename sequence is not power-loss/process-crash atomic; interrupted
restores may require manual recovery using those retained files. No automatic
startup replay is implemented.

Viewing CSV includes a UTF-8 BOM, CRLF records, column headers, proper quoting,
and formula-injection protection for text. Monetary integer minor units become
decimal strings. Foreign keys remain IDs. These are viewing exports, **not a
restore/import format**; no corresponding table import command exists.

## Validation

From `desktop-app/src-tauri`:

```sh
cargo fmt --check
cargo test --offline
cargo clippy --offline --all-targets -- -D warnings
```

`tests.rs` preserves the behavioral suite using a test-only intent adapter that
calls the direct feature operations. Additional direct-operation tests verify
conflicting/absent intents, fixed cover and import operations, and atomic form
validation. Storage tests cover isolation/restart, migrations/checksums, legacy
imports, and unsafe/nonempty import targets. Production has no intent adapter.
