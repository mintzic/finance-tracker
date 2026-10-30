# Welcome to React Router!

## Desktop app (Windows, macOS, and Linux)

The Electron app bundles the React Router frontend, local backend, SQLite database
support, and migrations. End users do not need Node.js or a separate server.
Development and packaging require Node.js 24 and npm.

```bash
npm ci
npm run desktop:start
```

Create installers on the target operating system:

```bash
npm run desktop:build
```

Installers are written to `release/`: Windows NSIS `.exe`, macOS `.dmg` and `.zip`,
and Linux `.AppImage` and `.deb`. Builds default to the machine's architecture.
For an Intel Mac build on macOS, run `npm run desktop:build -- --x64`; for Apple
Silicon, use `--arm64`. Native compilation may require platform developer tools
when SQLite prebuilt binaries are unavailable.

`npm run desktop:pack` creates an unpacked application for inspection.
After building, `npm run desktop:test` checks migrations, persistence, local server
access controls, static assets, and exports. `npm run desktop:smoke` opens the app
against a temporary database and checks that the dashboard renders.

Desktop packaging rebuilds SQLite for Electron. Before switching back to the web
server or Node-based tests, run `npm run web:rebuild`. Desktop start rebuilds it
for Electron again automatically.

The [desktop workflow](.github/workflows/desktop.yml) builds on Windows, macOS,
and Linux when manually dispatched or when a `v*` tag is pushed. It tests the
packaged app and uploads installers as workflow artifacts; it does not publish
releases. The initial workflow produces unsigned builds. Public distribution
should configure platform signing credentials and macOS notarization. App icons
currently use Electron's default icon.

Desktop data is stored separately from the web app's `data/` directory:

- Windows: `%APPDATA%/Finance Tracker/`
- macOS: `~/Library/Application Support/Finance Tracker/`
- Linux: `$XDG_CONFIG_HOME/Finance Tracker/` (usually `~/.config/Finance Tracker/`)

Each folder contains `finance.sqlite` and `receipts/`. Migrations run automatically
at startup. Existing web data is not automatically imported. To move an existing
workspace, close both apps and copy the database and receipts together. If SQLite
WAL files are present, use a SQLite backup or copy the complete database file set
while the source app is closed. Each installation is independent and has no sync.

The local backend listens only on loopback on a random port and requires a random
session credential. The window uses sandboxing and context isolation without Node
integration. New windows and navigation to external origins are blocked.

This tracker opens directly into a single workspace without sign-in or user accounts. Financial records belong to the workspace. Anyone who can reach the server can view and edit the workspace, including exports and receipts.

Run `npm run migrate` before starting the app on a new or existing database. The shared-workspace migration preserves financial records and removes the old authentication tables and user ID columns. Budgets with the same month and category are combined by adding their amounts.

Active subscriptions automatically record expenses in their selected account under Home & bills (or its renamed category; Other if deleted) when the tracker opens or transactions are exported. All due dates through today (Asia/Singapore) are processed, including missed dates; each billing date is recorded once. Next due advances automatically. Paused, cancelled, and archived-account subscriptions are skipped. Resuming catches up missed dates unless Next due is moved forward. Monthly and yearly billing preserve the original day, clamping to the last day of shorter months. This updates the tracker ledger; it does not initiate bank payments. Processing runs on access, so overdue charges appear the next time the tracker is opened.

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.

Manage income and expense categories from **Categories** in the sidebar. Renaming updates existing transactions and budgets. Deleting moves records to Other and combines budget limits for matching months. Other is reserved as a fallback; transfer categories remain fixed. Run `npm run migrate` to install category storage before starting the updated app.
