import { access, constants } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname shim (this file runs in the Electron main process)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLATFORM_KEY = `${process.platform}-${process.arch}`;
const EXE = process.platform === 'win32' ? '.exe' : '';

/** Absolute path to the platform-specific tools directory. */
function toolsRoot(): string {
  if (process.env.DEV) {
    // Development: tools live relative to the project root (two levels above
    // src-electron/services/)
    return path.join(__dirname, '../../../resources/tools', PLATFORM_KEY);
  }
  // Production: Electron packager copies resources/ next to the app
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

export const ToolResolver = {
  /** Path to arm-none-eabi-gdb (bundled or system) */
  gdb: (): Promise<string> => resolve('arm-none-eabi-gdb'),

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
};
