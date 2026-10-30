# Welcome to React Router!

This tracker opens directly into a single workspace without sign-in or user accounts. Financial records belong to the workspace. Anyone who can reach the server can view and edit the workspace, including exports and receipts.

Run `npm run migrate` before starting the app on a new or existing database. The shared-workspace migration preserves financial records and removes the old authentication tables and user ID columns. Budgets with the same month and category are combined by adding their amounts.

Active subscriptions automatically record expenses in their selected account under Home & bills when the tracker opens or transactions are exported. All due dates through today (Asia/Singapore) are processed, including missed dates; each billing date is recorded once. Next due advances automatically. Paused, cancelled, and archived-account subscriptions are skipped. Resuming catches up missed dates unless Next due is moved forward. Monthly and yearly billing preserve the original day, clamping to the last day of shorter months. This updates the tracker ledger; it does not initiate bank payments. Processing runs on access, so overdue charges appear the next time the tracker is opened.

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
