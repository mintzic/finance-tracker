<p align="center">
  <img src="folio-app/src/assets/icon.png" alt="Folio logo" width="140" />
</p>

<h1 align="center">Folio</h1>

<p align="center"><strong>Your money, with intention.</strong></p>

Folio is a local-first desktop finance tracker for keeping everyday spending, budgets, subscriptions, and savings goals in one place. Built with React, Rust, and Tauri, it pairs a calm interface with local SQLite storage—without running an Electron or Node.js server in the installed app.

![Folio reports showing monthly cash flow, spending by category, and account balances](docs/Screenshot%202026-11-07%20at%207.07.53%E2%80%AFPM.png)

## Features

- **Accounts and transfers** — organize your balances and track money moving between accounts.
- **Income and expenses** — record transactions, categorize them, and search, filter, or sort your history.
- **Budgets** — plan spending by category and monitor your progress.
- **Subscriptions** — keep recurring costs in view.
- **Savings goals** — track goals and contributions over time.
- **Reports** — explore monthly cash flow, spending breakdowns, income and expense trends, and month-end account balances.
- **Multiple ledgers** — separate personal, work, or other finances, each with its own accounts, records, and currency.
- **Receipts and CSV tools** — keep receipt attachments alongside your records and import or export transaction data.
- **Personalization** — customize your profile and give each ledger its own cover image.

### A closer look

#### Income

![Folio income view with category breakdown, six-month chart, and transaction filters](docs/Screenshot%202026-11-07%20at%207.07.22%E2%80%AFPM.png)

#### Expenses

![Folio expenses view with spending categories, six-month chart, and transaction history](docs/Screenshot%202026-11-07%20at%207.07.29%E2%80%AFPM.png)

## Tech stack

| Layer    | Technologies                                     |
| -------- | ------------------------------------------------ |
| Desktop  | Tauri 2                                          |
| Frontend | React 19, TypeScript, Vite, React Router         |
| UI       | Tailwind CSS 4, shadcn/ui, Base UI, Lucide icons |
| Charts   | Recharts                                         |
| Backend  | Rust                                             |
| Storage  | SQLite through `rusqlite`                        |

The React interface calls Tauri commands for financial operations. Validation and database queries run in Rust, and financial records are stored locally.

## Getting started

### macOS signing notice

The macOS app is **self-signed**, rather than signed with an Apple Developer ID certificate. macOS Gatekeeper may block it on first launch or warn that the developer cannot be verified.

If you trust the source of your download:

1. Move Folio to your **Applications** folder and try opening it.
2. If macOS blocks it, open **System Settings → Privacy & Security**.
3. Find the notice about Folio, click **Open Anyway**, and confirm when prompted.

Only override this warning for a download you trust. You do not need to disable Gatekeeper system-wide.

### Prerequisites

Install:

- A current Node.js LTS release compatible with Vite 8, plus npm.
- Stable Rust and Cargo, with support for the Rust 2024 edition.
- The [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

### Run the desktop app

From the repository root:

```sh
cd folio-app
npm ci
npm run tauri dev
```

Tauri starts the Vite development server and opens the desktop app.

> `npm run dev` starts only the frontend. Financial operations require the Tauri runtime, so use `npm run tauri dev` for a working app. The `server/` directory is not required.

### First launch

Folio creates a `You` profile and a `Default` ledger. Update your profile in Settings, add your accounts, and start recording transactions. You can create and switch between additional ledgers as needed.

Each ledger uses a single currency selected at creation. The suggested currency comes from local OS regional settings, falling back to USD. Folio does not convert amounts between currencies.

## Development and builds

Run these commands from `folio-app/`:

| Command                                                                          | Purpose                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------- |
| `npm run tauri dev`                                                              | Run the desktop app in development mode     |
| `npm run lint`                                                                   | Run ESLint                                  |
| `npm run build`                                                                  | Type-check and build the frontend           |
| `cargo test --manifest-path src-tauri/Cargo.toml`                                | Run Rust tests                              |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Run Rust lint checks                        |
| `npm run tauri build`                                                            | Build desktop bundles for the host platform |

Desktop build artifacts are written under `folio-app/src-tauri/target/release/`, with installers and bundles in its `bundle/` directory. Distribution and signing requirements depend on the target platform.

## Local data and backups

Folio stores its data in the operating system's application-data directory. The current Tauri application identifier is `com.mintzic.folio-finance`.

```text
folio.sqlite           # Profile, ledger registry, and app settings
ledgers/<uuid>.sqlite  # Financial records for each ledger
backups/               # Database backups created before ledger deletion
```

On macOS, the application-data directory is typically:

```text
~/Library/Application Support/com.mintzic.folio-finance/
```

Keep a backup of the entire application-data directory while the app is closed, especially before upgrades or legacy imports. Local storage is not a substitute for a backup.

Deleting a ledger requires confirmation and creates a database backup; the last ledger cannot be deleted. Resetting data affects only the active ledger.

For legacy Electron imports, earlier Tauri database migrations, and image-processing limits, see the [desktop documentation](folio-app/README.md).

## Project structure

```text
.
├── docs/                    # App screenshots
├── folio-app/
│   ├── src/                 # React interface, routes, and shared components
│   ├── src-tauri/
│   │   ├── src/             # Rust commands, storage, and schema
│   │   ├── migrations/      # Database migrations
│   │   └── tauri.conf.json  # Desktop configuration
│   └── package.json         # Frontend and desktop development scripts
└── server/                  # Placeholder package; not used by the desktop app
```

## Contributing

Bug reports and focused pull requests are welcome. Include reproduction steps for bugs, and run the relevant frontend and Rust checks before submitting changes. Never include personal financial records, receipts, or local databases in a report or commit.
