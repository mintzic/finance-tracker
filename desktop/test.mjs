import electron from 'electron';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = mkdtempSync(join(tmpdir(), 'finance-desktop-test-'));
const result = spawnSync(electron, ['--test', 'tests/desktop.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', DESKTOP_TEST_DIRECTORY: directory },
});
rmSync(directory, { recursive: true, force: true });
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
