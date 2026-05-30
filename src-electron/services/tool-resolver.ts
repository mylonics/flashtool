import { access, constants, readdir } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname shim (this file runs in the Electron main process)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFileAsync = promisify(execFile);
const PLATFORM_KEY = `${process.platform}-${process.arch}`;
const EXE = process.platform === 'win32' ? '.exe' : '';

/** Absolute path to the platform-specific tools directory. */
function toolsRoot(): string {
  if (process.env.DEV) {
    // In dev mode Quasar compiles the main process to .quasar/dev-electron/,
    // so ../../ from __dirname reaches the project root.
    return path.join(__dirname, '../../resources/tools', PLATFORM_KEY);
  }
  // Production: Electron packager copies resources/ next to the app
  // (see extraResource in quasar.config.ts).
  return path.join(process.resourcesPath, 'tools', PLATFORM_KEY);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Cache resolved paths so we only hit the FS once per binary.
const cache = new Map<string, string>();

async function resolve(name: string): Promise<string> {
  const key = name;
  if (cache.has(key)) return cache.get(key)!;

  const bundled = path.join(toolsRoot(), `${name}${EXE}`);
  const resolved = (await fileExists(bundled)) ? bundled : name;
  cache.set(key, resolved);

  if (resolved !== name) {
    console.log(`[tools] Using bundled ${name}: ${resolved}`);
  } else {
    console.log(`[tools] ${name} not bundled — using system PATH`);
  }

  return resolved;
}

/**
 * When OpenOCD is bundled its scripts directory is co-located with the binary.
 * Returns the path to inject via `-s <dir>`, or null when using system install.
 */
async function openocdScriptsDir(): Promise<string | null> {
  const bundled = path.join(toolsRoot(), `openocd${EXE}`);
  if (await fileExists(bundled)) {
    return path.join(toolsRoot(), 'openocd-scripts');
  }
  return null;
}

/**
 * Locate a suitable arm GDB, searching in order:
 *   1. Bundled arm-none-eabi-gdb
 *   2. Zephyr IDE toolchains (~/.zephyr_ide/toolchains/<ver>/arm-zephyr-eabi/bin/)
 *   3. Fall back to bare name (system PATH lookup at spawn time)
 */
async function findGdb(): Promise<string> {
  const cacheKey = '__gdb__';
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  // 1. Bundled
  const bundled = path.join(toolsRoot(), `arm-none-eabi-gdb${EXE}`);
  if (await fileExists(bundled)) {
    console.log(`[tools] Using bundled GDB: ${bundled}`);
    cache.set(cacheKey, bundled);
    return bundled;
  }

  // 2. Zephyr IDE toolchains
  const zephyrIdePath = path.join(os.homedir(), '.zephyr_ide', 'toolchains');
  try {
    const versions = await readdir(zephyrIdePath);
    // Sort descending so the newest SDK is tried first
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const binDir = path.join(zephyrIdePath, version, 'arm-zephyr-eabi', 'bin');
      for (const name of ['arm-zephyr-eabi-gdb', 'arm-zephyr-eabi-gdb-py']) {
        const candidate = path.join(binDir, `${name}${EXE}`);
        if (await fileExists(candidate)) {
          console.log(`[tools] Found Zephyr SDK GDB: ${candidate}`);
          cache.set(cacheKey, candidate);
          return candidate;
        }
      }
    }
  } catch { /* no Zephyr IDE directory */ }

  // 3. PATH fallback
  console.log('[tools] GDB not found in known locations — falling back to system PATH');
  cache.set(cacheKey, 'arm-none-eabi-gdb');
  return 'arm-none-eabi-gdb';
}

async function walkCfgs(dir: string, prefix: string, results: string[]): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walkCfgs(path.join(dir, e.name), relPath, results);
      } else if (e.name.endsWith('.cfg')) {
        results.push(relPath);
      }
    }
  } catch { /* subdir doesn't exist or unreadable */ }
}

/**
 * Locate the system openocd binary via `where` (Windows) or `which` (Unix)
 * and derive the scripts directory from its location.
 */
async function findSystemOpenOcdScriptsDir(): Promise<string | null> {
  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(cmd, ['openocd'], { timeout: 3000 });
    const binary = stdout.trim().split(/\r?\n/)[0]?.trim() ?? '';
    if (!binary || !(await fileExists(binary))) return null;

    const binDir = path.dirname(binary);
    const base   = path.dirname(binDir);

    // Try layout variants: FHS, xPack (.content/openocd/scripts), bare
    for (const candidate of [
      path.join(base,   'share', 'openocd', 'scripts'),
      path.join(base,   'openocd', 'scripts'),
      path.join(base,   'scripts'),
      path.join(binDir, 'scripts'),
    ]) {
      if (await fileExists(candidate)) return candidate;
    }
  } catch { /* openocd not in PATH */ }
  return null;
}

/**
 * List all .cfg files inside the given OpenOCD scripts subdirectories.
 * Searches the bundled scripts dir first, then auto-detects from the system
 * openocd binary, then falls back to common install paths.
 * Returns relative paths like "board/stm32f4discovery.cfg".
 */
async function listOpenOcdCfgs(subdirs: string[]): Promise<string[]> {
  const candidates: string[] = [];

  const bundledScripts = await openocdScriptsDir();
  if (bundledScripts) candidates.push(bundledScripts);

  const systemScripts = await findSystemOpenOcdScriptsDir();
  if (systemScripts) candidates.push(systemScripts);

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\OpenOCD\\share\\openocd\\scripts',
      'C:\\Program Files (x86)\\OpenOCD\\share\\openocd\\scripts',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/usr/local/share/openocd/scripts',
      '/opt/homebrew/share/openocd/scripts',
    );
  } else {
    candidates.push(
      '/usr/share/openocd/scripts',
      '/usr/local/share/openocd/scripts',
    );
  }

  const seen = new Set<string>();
  for (const base of candidates) {
    if (seen.has(base)) continue;
    seen.add(base);
    if (!(await fileExists(base))) continue;
    const results: string[] = [];
    for (const subdir of subdirs) {
      await walkCfgs(path.join(base, subdir), subdir, results);
    }
    if (results.length > 0) return results.sort();
  }

  return [];
}

export const ToolResolver = {
  /** Path to arm GDB: bundled → Zephyr SDK → system PATH */
  gdb: findGdb,

  /** Path to openocd (bundled or system) */
  openocd: (): Promise<string> => resolve('openocd'),

  /**
   * Path to the OpenOCD scripts directory when using the bundled binary.
   * Pass as `-s <dir>` so OpenOCD can find interface/board configs.
   * Returns null when OpenOCD is taken from the system PATH (it knows its own scripts location).
   */
  openocdScriptsDir,

  /** Path to st-flash (bundled or system) */
  stFlash: (): Promise<string> => resolve('st-flash'),

  /** Path to st-info (bundled or system) */
  stInfo: (): Promise<string> => resolve('st-info'),

  /** List .cfg files in the given OpenOCD script subdirectories (e.g. ['target','board']) */
  listOpenOcdCfgs,
};
