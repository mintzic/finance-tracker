# Native finance commands

The former `src/finance/` implementation and this README now live under
`src/commands/`. There is no production `mutate` or `profile_action` IPC command,
and no runtime mutation-intent dispatcher. `mod.rs::handler()` centrally registers
all commands, including the unchanged `app::greeting`.

## Layout and lifecycle

- `accounts.rs`, `transactions.rs`, `budgets.rs`, `categories.rs`,
  `subscriptions.rs`, and `goals.rs` own feature operations and IPC entry points.
- `files.rs` owns receipt storage, assets, and separate cover operations.
- `imports.rs` owns CSV preview/commit/export and the legacy import entry point.
- `overview.rs` owns dashboard queries and billing snapshots.
- `maintenance.rs` owns reset and fictional demo data.
- `profiles.rs` exposes fixed profile commands backed by `src/workspace.rs`.
- `shared.rs` owns validation, schema initialization, SQL utilities, state locking,
  and the callback-based immediate transaction helper.
- `ledger.rs` shares entry validation/writes, balance calculations, and anchored
  subscription billing. `schema.sql` supplies the fresh database schema.

`src/workspace.rs` still owns profile routing, migrations, backups, legacy copying,
and opening connections. It calls `commands::shared::initialize` after migration.
Initialization is idempotent and enables foreign keys outside a transaction;
existing legacy databases must already have migrations 0001–0008 applied. Records
are not reset or reseeded. Each connection represents one selected workspace.

Cover optimization uses `image` 0.25 with default features disabled and only
PNG, JPEG, and WebP codecs enabled.

## IPC contract

Argument names below are Tauri argument-object keys; managed state is injected.

| Command                                              | Arguments                |
| ---------------------------------------------------- | ------------------------ |
| `dashboard`                                          | `params`                 |
| `profiles`                                           | none                     |
| `create_profile`, `update_profile`, `switch_profile` | `form`                   |
| `save_account`, `adjust_account`, `delete_account`   | `form`                   |
| `save_transaction`, `delete_transaction`             | `form`                   |
| `save_budget`, `delete_budget`                       | `form`                   |
| `save_category`, `delete_category`                   | `form`                   |
| `save_subscription`, `save_goal`                     | `form`                   |
| `add_contribution`, `delete_contribution`            | `form`                   |
| `preview_import`, `commit_import`                    | `form`                   |
| `upload_cover`                                       | raw binary request body  |
| `remove_cover`, `position_cover`                     | `form`                   |
| `reset_workspace`, `seed_demo`                       | `form`                   |
| `asset`                                              | `kind`, `id`             |
| `export_csv`                                         | none                     |
| `import_legacy`                                      | `source`, `confirmation` |

Forms retain the existing feature field names. An `intent` field is unnecessary
and ignored: the command binds a fixed operation callback. In particular, preview
cannot commit, cover upload cannot remove, and profile update cannot create or
switch based on a supplied intent. `update_profile` updates the selected profile.
Profile creation takes `username` and optional `language`/`currency` (defaulting
to `en-SG`/`SGD`); switching takes `profile_id`.

Dashboard parameters are `month`, `view`, `q`, `account`, `category`, `page`, `sort`,
`dir`, and `edit`. Fields are strings (`page` also accepts a number). Return keys,
SQL row field names, integer minor-unit amounts, filters, sorting fallbacks,
20-row pagination, recent lists, six-month trends, recurring budgets, and
end-of-month balances preserve the legacy dashboard contract. Missing edits omit
`edit`; `cover` is null or `{version, position}`. Profile metadata is attached by
the dashboard command.

Form fields are strings, with checkbox values `"on"`. Decimal amounts are parsed
with integer arithmetic; returned amounts are integer minor units. Errors are
`Err(String)`; writes return `{message}` or import `{preview,csv,message}` objects.
Mutations use immediate transactions, including receipt bytes and metadata.
Dashboard billing and snapshots share an immediate transaction. Export bills due
subscriptions in a savepoint before reading the ledger. Today uses Singapore time.
Display currency/language are profile settings, not currency conversion; legacy
wallet currency remains SGD.

Account deletion preserves the existing archive policy (`policy: "keep"`) or
requires `policy: "delete"` and `confirmation: "DELETE"`. Reset requires
`confirmation: "RESET"`; legacy copying requires `confirmation: "IMPORT"` and
leaves source files untouched. Demo data requires an empty workspace.

## Files and CSV

Receipt/CSV uploads use `{ "name": "invoice.pdf", "mime": "application/pdf", "bytes": [37,80,68,70,45] }`
in `receipt` or `file`. Bytes must be integers from 0–255. Limits are
5 MiB for receipts and 1 MiB for CSV. Imports accept 1–1,000 records and
10,000 content bytes per record. CSV accepts UTF-8 BOM, quoted/multiline fields,
and reordered/extra columns; all eight legacy headers are required. Preview
never saves transactions. Duplicate detection covers existing manual entries and
within-batch duplicates; commit rejects invalid batches atomically. Export quotes
every data cell and protects spreadsheet formula cells.

Receipt MIME is detected from magic bytes, not supplied MIME/extension.
Receipts support PDF/PNG/JPEG.

Cover upload uses `invoke('upload_cover', uint8Array)` with a raw `Uint8Array`
body, **not** `{form}` or a JSON byte array. The async command copies the raw
body and opens the initiating workspace's connection under a brief workspace
mutex lock. It moves that connection into `spawn_blocking`, where decoding,
resizing, and encoding run without the global lock, before starting the database
transaction. Profile switches cannot redirect an in-flight upload. JSON requests
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
orphan them. Cover bytes remain in `workspace_cover.image`. Filenames are sanitized
and never used as filesystem paths. Asset serving does not access the filesystem.

`asset` with `kind: "receipt"` takes a receipt metadata ID; `kind: "cover"` takes
the current version (or `"1"` for the current cover). It returns
`{bytes, mime, filename}`. Unknown kinds and missing/stale IDs error. Cover
positioning requires the current `version`. Legacy external receipt files are
served only after legacy import copies their bytes into native storage.

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
validation. Workspace tests cover isolation/restart, migrations/checksums, legacy
imports, and unsafe/nonempty import targets. Production has no intent adapter.
