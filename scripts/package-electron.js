#!/usr/bin/env node
/**
 * package-electron.js
 * Packages the Quasar-built Electron app (dist/electron/UnPackaged) into a
 * distributable folder using @electron/packager's programmatic API.
 *
 * Why this exists instead of `npx electron-packager ...`:
 *   - `quasar build -m electron` produces dist/electron/UnPackaged but does not
 *     reliably complete the packaging step in CI.
 *   - The @electron/packager CLI silently exits 0 when it produces no output
 *     (it only logs "Wrote new app to:" on success), so a failed/empty package
 *     looks like success and the missing output dir is only discovered later.
 *   - The CLI's argument parsing for --out / --extra-resource is ambiguous.
 *
 * Calling the API directly with explicit, absolute options removes all of that
 * ambiguity and exits non-zero (with diagnostics) if nothing is produced.
 *
 * Output folder: dist/electron/Packaged/flashtool-<platform>-<arch>
 *
 * Usage:
 *   node scripts/package-electron.js --platform linux --arch x64
 */

import { packager } from '@electron/packager';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name) =>
  args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null;

const platform = getArg('platform');
const arch = getArg('arch');

if (!platform || !arch) {
  console.error(
    'Usage: node scripts/package-electron.js --platform <platform> --arch <arch>',
  );
  process.exit(1);
}

// ── Resolve paths ─────────────────────────────────────────────────────────────

const dir = path.join(ROOT, 'dist', 'electron', 'UnPackaged');
const out = path.join(ROOT, 'dist', 'electron', 'Packaged');
const toolsDir = path.join(ROOT, 'resources', 'tools');
const electronVersion = require('electron/package.json').version;

if (!existsSync(dir)) {
  console.error(
    `ERROR: expected Quasar build output at "${dir}" but it does not exist.\n` +
      'Run `quasar build -m electron` before packaging.',
  );
  process.exit(1);
}

console.log(`Packaging "flashtool" for ${platform}-${arch} (electron v${electronVersion})`);
console.log(`  source: ${dir}`);
console.log(`  output: ${out}`);

// ── Package ───────────────────────────────────────────────────────────────────

const options = {
  dir,
  out,
  name: 'flashtool',
  platform,
  arch,
  electronVersion,
  overwrite: true,
};

// Only bundle extra resources if the tools directory actually exists.
if (existsSync(toolsDir)) {
  options.extraResource = [toolsDir];
}

const appPaths = await packager(options);

if (!appPaths.length) {
  console.error(
    'ERROR: @electron/packager produced no output bundles. ' +
      `Options were: ${JSON.stringify(options)}`,
  );
  process.exit(1);
}

console.log(`Created ${appPaths.length} bundle(s):`);
for (const p of appPaths) {
  console.log(`  ${p}`);
}
