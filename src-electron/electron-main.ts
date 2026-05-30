import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { SessionManager } from './services/session-manager';
import { ProbeDetector } from './services/probe-detector';
import { ToolResolver } from './services/tool-resolver';
import { SerialPort } from 'serialport';
import { IPC } from '../src/types';
import type { ProbeInfo, FlashConfig } from '../src/types';

// ESM __dirname shim
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
const sessionManager = new SessionManager();
const probeDetector = new ProbeDetector();

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.resolve(
        __dirname,
        path.join(
          process.env.QUASAR_ELECTRON_PRELOAD_FOLDER ?? 'preload',
          'electron-preload' + (process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION ?? '.cjs'),
        ),
      ),
    },
  });

  if (process.env.DEV) {
    void mainWindow.loadURL(process.env.APP_URL ?? 'http://localhost:9000');
    mainWindow.webContents.openDevTools();
  } else {
    void mainWindow.loadFile(
      path.resolve(__dirname, 'index.html'),
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle(IPC.PROBE_DETECT, async () => {
  return probeDetector.detect();
});

ipcMain.handle(IPC.PORT_LIST, async () => {
  const ports = await SerialPort.list();
  return ports.map((p) => p.path).sort();
});

ipcMain.handle(IPC.OPENOCD_CFG_LIST, async (_event, subdirs: string[]) => {
  return ToolResolver.listOpenOcdCfgs(subdirs);
});

ipcMain.handle(
  IPC.FLASH_START,
  async (_event, sessionId: string, probe: ProbeInfo, config: FlashConfig) => {
    const logFn = (line: string) => {
      mainWindow?.webContents.send(`${IPC.FLASH_STATUS}:${sessionId}`, line);
    };
    const statusFn = (status: string, error?: string) => {
      mainWindow?.webContents.send(`session:status:${sessionId}`, status, error);
    };
    try {
      await sessionManager.flash(sessionId, probe, config, logFn, statusFn);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
);

ipcMain.handle(IPC.FLASH_CANCEL, async (_event, sessionId: string) => {
  sessionManager.cancelFlash(sessionId);
});

ipcMain.handle(
  IPC.RTT_START,
  async (_event, sessionId: string, probe: ProbeInfo, config: FlashConfig) => {
    const dataFn = (line: string, type: 'output' | 'error' | 'info') => {
      mainWindow?.webContents.send(`${IPC.RTT_DATA}:${sessionId}`, line, type);
    };
    const statusFn = (status: string, error?: string) => {
      mainWindow?.webContents.send(`session:status:${sessionId}`, status, error);
    };
    try {
      await sessionManager.startRtt(sessionId, probe, config, dataFn, statusFn);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
);

ipcMain.handle(IPC.RTT_STOP, async (_event, sessionId: string) => {
  sessionManager.stopRtt(sessionId);
});

ipcMain.handle(
  IPC.FLASH_AND_RTT_START,
  async (_event, sessionId: string, probe: ProbeInfo, config: FlashConfig) => {
    const logFn = (line: string) => {
      mainWindow?.webContents.send(`${IPC.FLASH_STATUS}:${sessionId}`, line);
    };
    const dataFn = (line: string, type: 'output' | 'error' | 'info') => {
      mainWindow?.webContents.send(`${IPC.RTT_DATA}:${sessionId}`, line, type);
    };
    const statusFn = (status: string, error?: string) => {
      mainWindow?.webContents.send(`session:status:${sessionId}`, status, error);
    };
    try {
      await sessionManager.flashAndStartRtt(sessionId, probe, config, logFn, dataFn, statusFn);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
);

ipcMain.handle(
  'dialog:openFile',
  async (_event, filters: Electron.FileFilter[]) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters,
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  },
);

// ─── App lifecycle ─────────────────────────────────────────────────────────────

void app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  sessionManager.disposeAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
