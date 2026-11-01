<p align="center">
  <img src="./desktop/resources/icon.png" alt="Finance Tracker sleeping cat logo" width="160" />
</p>

<h1 align="center">Welcome to Finance Tracker</h1>

<p align="center">
  A calmer place for your money.<br />
  Track everyday spending, plan your budget, and keep your goals in sight.
</p>

<p align="center">
  <strong>Web & desktop</strong> · <strong>Local SQLite storage</strong> · <strong>No sign-in required</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#database--storage">Database & storage</a> ·
  <a href="#desktop-packaging">Desktop packaging</a> ·
  <a href="#credits">Credits</a>
</p>

---

## Your finances, in one workspace

Finance Tracker brings income, expenses, budgets, subscriptions, and savings goals together in a single workspace. Use it in your browser or as a standalone desktop app on Windows, macOS, and Linux.

| Keep track                                      | Plan ahead                             | Make it yours                        |
| ----------------------------------------------- | -------------------------------------- | ------------------------------------ |
| Record income, expenses, and transfers          | Set monthly category budgets           | Manage income and expense categories |
| Organize accounts and attach receipts           | Follow savings goals and contributions | Customize your workspace cover       |
| Import transactions from CSV and export records | Track recurring subscription expenses  | Use the web or desktop app           |

Each installation stores its own data. Web and desktop workspaces are independent and do not sync automatically.

## Quick start

Development and packaging require **Node.js 24** and **npm**. Install dependencies from the project root:

```bash
npm ci
```

### Desktop

```bash
npm run desktop:start
```

This builds and launches the Electron app. The database and tables are created automatically before the window opens, and pending migrations run on every startup. End users of the packaged app do not need Node.js or a separate server.

### Web development

```bash
npm run migrate
npm run dev
```

Open `http://localhost:5173`. The development server includes hot module replacement.

### Web production

```bash
npm run migrate
npm run build
npm start
```

Web mode requires an explicit migration step before starting a new database or using an updated schema.

> **Switching between desktop and web?** Desktop tooling rebuilds the native SQLite dependency for Electron. Run `npm run web:rebuild` before returning to the web server or Node-based tests. `npm run desktop:start` rebuilds it for Electron automatically.

## Database & storage

### What happens when you run a command?

| Command                                          | Database behavior                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                    | Opens or creates the SQLite file when the server loads; does not run migrations or create application tables. |
| `npm run build`                                  | Builds the web app; does not initialize tables or run migrations.                                             |
| `npm start`                                      | Opens or creates the SQLite file; does not run migrations or create application tables.                       |
| `npm run migrate`                                | Creates the database if needed and applies pending migrations to create or update tables.                     |
| `npm run desktop:start`                          | Builds and launches the app; creates the database and applies pending migrations automatically.               |
| `npm run desktop:build` / `npm run desktop:pack` | Packages the app. Database initialization happens when the packaged app launches.                             |

### Where your data lives

| Mode / platform   | Default location                                                          |
| ----------------- | ------------------------------------------------------------------------- |
| Web               | `data/finance.sqlite`, relative to the working directory                  |
| Desktop · Windows | `%APPDATA%/Finance Tracker/`                                              |
| Desktop · macOS   | `~/Library/Application Support/Finance Tracker/`                          |
| Desktop · Linux   | `$XDG_CONFIG_HOME/Finance Tracker/`, usually `~/.config/Finance Tracker/` |

Desktop data folders contain `finance.sqlite` and `receipts/`.

For web mode, set `DATABASE_PATH` to use a different database file. Use the same value for migration and server commands. The migration command loads `.env` if present; ensure the server receives the same configuration.

### Moving an existing workspace

Close both apps before moving data, and copy the database and receipts together. If SQLite WAL files are present, use a SQLite backup or copy the complete database file set while the source app is closed. Existing web data is not automatically imported into desktop mode.

<details>
<summary><strong>Upgrading from the older account-based workspace</strong></summary>

The shared-workspace migration preserves financial records and removes the old authentication tables and user ID columns. Budgets with the same month and category are combined by adding their amounts. Run `npm run migrate` in web mode; desktop mode applies this automatically at startup.

</details>

## A few useful details

### Categories that stay connected

Manage income and expense categories from **Categories** in the sidebar. Renaming a category updates existing transactions and budgets. Deleting one moves its records to **Other** and combines budget limits for matching months. **Other** is reserved as a fallback; transfer categories remain fixed.

### Subscriptions that catch up

Active subscriptions record expenses in their selected account when the tracker opens or transactions are exported. Due dates are processed through today in **Asia/Singapore**, including missed dates, with each billing date recorded once.

- Expenses use **Home & bills**, its renamed category, or **Other** if it was deleted.
- Paused, cancelled, and archived-account subscriptions are skipped.
- Resuming catches up missed dates unless **Next due** is moved forward.
- Monthly and yearly billing preserve the original day, clamping to the last day of shorter months.

This updates the tracker ledger; it does not initiate bank payments. Processing happens on access, so overdue charges appear the next time the workspace opens.

### Workspace access

The app opens directly without sign-in or user accounts. Anyone who can reach the web server can view and edit the workspace, including exports and receipts. Keep web access limited to people you trust.

The desktop backend listens only on loopback, uses a random port and session credential, and runs its window with sandboxing and context isolation. New windows and navigation to external origins are blocked.

## Desktop packaging

Build installers on the target operating system:

```bash
npm run desktop:build
```

Outputs are written to `release/`:

| Platform | Formats             |
| -------- | ------------------- |
| Windows  | NSIS `.exe`         |
| macOS    | `.dmg`, `.zip`      |
| Linux    | `.AppImage`, `.deb` |

Builds use the machine's architecture by default. On macOS, use `npm run desktop:build -- --x64` for Intel or `npm run desktop:build -- --arm64` for Apple Silicon. Native compilation may require platform developer tools when SQLite prebuilt binaries are unavailable.

Use `npm run desktop:pack` to create an unpacked application for inspection.

### macOS releases from GitHub Actions

macOS installers use **ad-hoc signing** (`mac.identity: "-"`) with hardened runtime enabled and notarization disabled. No Apple Developer membership, certificate, or repository secrets are required. The workflow verifies the ad-hoc signature and smoke tests the packaged application before uploading installers.

The app and its helpers use explicit Electron entitlements, including `disable-library-validation`, so hardened runtime can load Electron frameworks and the native SQLite module without an Apple Team ID.

Ad-hoc signing does not establish an Apple-verified developer identity or pass normal Gatekeeper distribution checks. After installing and attempting to open the app, users may need to go to **System Settings → Privacy & Security → Open Anyway** to approve the app. See [Apple's instructions for opening downloaded apps](https://support.apple.com/en-gb/102445). A “damaged” warning can also indicate a broken signature; overriding Gatekeeper does not repair that.

Run the Desktop builds workflow from the updated commit with a new release tag, then download the new installer. Existing release downloads remain unchanged until rebuilt. For distribution without these manual approvals, switch to Developer ID Application signing and Apple notarization.

To change the sleeping cat icon, replace [the app icon](desktop/resources/icon.png) with a square 1024 × 1024 PNG and rebuild.

## Development checks

| Command                 | Purpose                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | Generate route types and check TypeScript.                                                                            |
| `npm run desktop:test`  | After building, check migrations, persistence, local server access controls, static assets, and exports.              |
| `npm run desktop:smoke` | After building and rebuilding SQLite for Electron, launch against a temporary database and check dashboard rendering. |

Built with React Router, React, TypeScript, Tailwind CSS, Drizzle ORM, SQLite, and Electron.

---

## Credits

Created and maintained by:

<a href="https://github.com/mintzic">
  <img src="https://github.com/mintzic.png?size=160" alt="mintzic's GitHub profile" width="80" height="80" align="middle" />
  <strong>mintzic</strong>
</a>
