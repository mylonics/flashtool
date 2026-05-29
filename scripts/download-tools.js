#!/usr/bin/env node
/**
 * download-tools.js
 * Downloads and extracts tool binaries declared in tool-manifest.json into
 * resources/tools/{platform-arch}/.
 *
 * Usage:
 *   node scripts/download-tools.js                   # current platform
 *   node scripts/download-tools.js --platform win32-x64
 *   node scripts/download-tools.js --all             # all platforms in manifest
 *   node scripts/download-tools.js --tool openocd    # single tool
 */

import https from 'https';
import http from 'http';
import { createWriteStream, createReadStream, chmodSync, existsSync } from 'fs';
import { mkdir, copyFile, readdir, stat, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { createGunzip } from 'zlib';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const platformArg = args.includes('--platform')
  ? args[args.indexOf('--platform') + 1]
  : null;
const allPlatforms = args.includes('--all');
const toolFilter = args.includes('--tool')
  ? args[args.indexOf('--tool') + 1]
  : null;

const currentPlatform = `${process.platform}-${process.arch}`;
const targetPlatforms = allPlatforms
  ? null  // determined from manifest
  : [platformArg ?? currentPlatform];

// ── Manifest ──────────────────────────────────────────────────────────────────

const manifest = JSON.parse(
  (await import('fs')).readFileSync(path.join(ROOT, 'tool-manifest.json'), 'utf8'),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const get = url.startsWith('https') ? https.get : http.get;

    const request = (targetUrl) => {
      get(targetUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total) {
            const pct = Math.round((received / total) * 100);
            process.stdout.write(`\r  ${pct}% (${(received / 1e6).toFixed(1)} MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => { process.stdout.write('\n'); file.close(resolve); });
        file.on('error', reject);
      }).on('error', reject);
    };

    request(url);
  });
}

async function extractZip(archive, destDir, entries) {
  // Use PowerShell on Windows, unzip on Unix
  const tmpDir = path.join(os.tmpdir(), `flashtool-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  if (process.platform === 'win32') {
    await execAsync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${archive}' -DestinationPath '${tmpDir}' -Force"`,
    );
  } else {
    await execAsync(`unzip -q "${archive}" -d "${tmpDir}"`);
  }

  await copyEntries(tmpDir, destDir, entries);
  await rm(tmpDir, { recursive: true, force: true });
}

async function extractTgz(archive, destDir, entries) {
  const tmpDir = path.join(os.tmpdir(), `flashtool-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  await execAsync(`tar -xzf "${archive}" -C "${tmpDir}"`);
  await copyEntries(tmpDir, destDir, entries);
  await rm(tmpDir, { recursive: true, force: true });
}

async function copyEntries(srcRoot, destDir, entries) {
  for (const entry of entries) {
    const srcPath = path.join(srcRoot, entry.src.replace(/\//g, path.sep));
    const destPath = path.join(destDir, entry.dest.replace(/\//g, path.sep));

    if (entry.isGlob) {
      // Copy all files matching the glob pattern from src dir to dest dir
      const srcDir = path.join(srcRoot, entry.src.replace(/\//g, path.sep));
      const files = await readdir(srcDir);
      const pattern = new RegExp(entry.glob.replace('*', '.*'));
      for (const f of files) {
        if (pattern.test(f)) {
          await copyFile(path.join(srcDir, f), path.join(destPath, f));
        }
      }
      continue;
    }

    const srcStat = await stat(srcPath).catch(() => null);
    if (!srcStat) {
      console.warn(`  Warning: ${entry.src} not found in archive — skipping`);
      continue;
    }

    if (entry.isDir || srcStat.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await mkdir(path.dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
      // Make executable on Unix
      if (process.platform !== 'win32') {
        chmodSync(destPath, 0o755);
      }
    }
  }
}

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else {
      await copyFile(s, d);
      if (process.platform !== 'win32') chmodSync(d, 0o755);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const toolNames = Object.keys(manifest.tools).filter(
  (t) => !toolFilter || t === toolFilter,
);

const platforms = allPlatforms
  ? [...new Set(toolNames.flatMap((t) => Object.keys(manifest.tools[t].platforms ?? {})))]
  : targetPlatforms;

console.log(`Downloading tools for: ${platforms.join(', ')}`);

for (const platform of platforms) {
  for (const toolName of toolNames) {
    const toolDef = manifest.tools[toolName];
    const platDef = toolDef?.platforms?.[platform];

    if (!platDef) {
      console.log(`  [${toolName}] No bundle available for ${platform} — will use system PATH`);
      continue;
    }

    const destDir = path.join(ROOT, 'resources', 'tools', platform);
    await mkdir(destDir, { recursive: true });

    const archiveName = platDef.url.split('/').pop();
    const archivePath = path.join(os.tmpdir(), `flashtool-${archiveName}`);

    if (existsSync(archivePath)) {
      console.log(`  [${toolName}] Using cached archive: ${archiveName}`);
    } else {
      console.log(`  [${toolName}] Downloading ${platDef.url}`);
      await download(platDef.url, archivePath);
    }

    console.log(`  [${toolName}] Extracting to resources/tools/${platform}/`);
    if (platDef.type === 'zip') {
      await extractZip(archivePath, destDir, platDef.extract);
    } else if (platDef.type === 'tgz') {
      await extractTgz(archivePath, destDir, platDef.extract);
    }

    console.log(`  [${toolName}] Done`);
  }
}

console.log('\nAll tools downloaded successfully.');
