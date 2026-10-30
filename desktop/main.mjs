import { app, BrowserWindow, dialog, session } from 'electron';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { migrate } from './migrate.mjs';

app.setName('Finance Tracker');
let window;
let server;
let origin;
const smoke = process.argv.includes('--smoke-test');
const smokeDirectory = smoke ? mkdtempSync(join(tmpdir(), 'finance-desktop-')) : undefined;
if (smokeDirectory) app.setPath('userData', smokeDirectory);
if (smoke) setTimeout(() => showError(new Error('Desktop smoke test timed out')), 30000).unref();

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 900, minHeight: 640,
    show: !smoke, backgroundColor: '#ffffff',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.on('closed', () => { window = undefined; });
  return window.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    // Set paths before importing the server build, which opens SQLite on import.
    const dataDirectory = app.getPath('userData');
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_PATH = join(dataDirectory, 'finance.sqlite');
    process.env.RECEIPT_DIR = join(dataDirectory, 'receipts');
    await migrate(process.env.DATABASE_PATH, join(app.getAppPath(), 'migrations'));
    const { startServer } = await import('./server.mjs');
    const local = await startServer(app.getAppPath());
    server = local.server;
    origin = local.origin;
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    await session.defaultSession.cookies.set({
      url: origin, name: 'desktop_session', value: local.token, httpOnly: true, sameSite: 'strict',
    });
    if (smoke) {
      const response = await fetch(origin, { headers: { Cookie: `desktop_session=${local.token}` } });
      if (!response.ok) throw new Error(`Desktop server returned ${response.status}`);
    }
    await createWindow();
    if (smoke) {
      const text = await window.webContents.executeJavaScript('document.body.innerText');
      if (!text || /Unexpected Application Error|Application Error/.test(text)) throw new Error('Desktop render failed');
      console.log('Desktop smoke test passed');
      app.exit(0);
    }
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow().catch(showError);
    });
  }).catch(showError);
}

function showError(error) {
  console.error(error);
  if (!smoke) dialog.showErrorBox('Finance Tracker could not start', error.message);
  app.exit(1);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => server?.close());
app.on('quit', () => {
  if (smokeDirectory) {
    // Windows may keep SQLite files locked until the process has fully exited.
    try { rmSync(smokeDirectory, { recursive: true, force: true }); } catch {}
  }
});
