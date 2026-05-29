import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../src/types';
import type { ProbeInfo, FlashConfig, RttLine } from '../src/types';

// Expose a safe, typed API surface to the renderer process
contextBridge.exposeInMainWorld('flashToolApi', {
  /** Detect connected probes (BMP + STLink) */
  detectProbes: (): Promise<ProbeInfo[]> =>
    ipcRenderer.invoke(IPC.PROBE_DETECT),

  /** Flash firmware to a target */
  flash: (
    sessionId: string,
    probe: ProbeInfo,
    config: FlashConfig,
  ): Promise<void> =>
    ipcRenderer.invoke(IPC.FLASH_START, sessionId, probe, config),

  /** Cancel an in-progress flash */
  cancelFlash: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.FLASH_CANCEL, sessionId),

  /** Start RTT session */
  startRtt: (
    sessionId: string,
    probe: ProbeInfo,
    config: FlashConfig,
  ): Promise<void> =>
    ipcRenderer.invoke(IPC.RTT_START, sessionId, probe, config),

  /** Stop RTT session */
  stopRtt: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.RTT_STOP, sessionId),

  /** Open a file picker dialog */
  openFileDialog: (
    filters: Array<{ name: string; extensions: string[] }>,
  ): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile', filters),

  /** Subscribe to flash log lines for a session */
  onFlashStatus: (sessionId: string, cb: (line: string) => void) => {
    const channel = `${IPC.FLASH_STATUS}:${sessionId}`;
    const handler = (_event: Electron.IpcRendererEvent, line: string) =>
      cb(line);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /** Subscribe to RTT data for a session */
  onRttData: (
    sessionId: string,
    cb: (line: string, type: RttLine['type']) => void,
  ) => {
    const channel = `${IPC.RTT_DATA}:${sessionId}`;
    const handler = (
      _event: Electron.IpcRendererEvent,
      line: string,
      type: RttLine['type'],
    ) => cb(line, type);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /** Subscribe to session status changes */
  onSessionStatus: (
    sessionId: string,
    cb: (status: string, error?: string) => void,
  ) => {
    const channel = `session:status:${sessionId}`;
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: string,
      error?: string,
    ) => cb(status, error);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

// TypeScript augmentation so renderer files see the window.flashToolApi type
declare global {
  interface Window {
    flashToolApi: {
      detectProbes: () => Promise<ProbeInfo[]>;
      flash: (
        sessionId: string,
        probe: ProbeInfo,
        config: FlashConfig,
      ) => Promise<void>;
      cancelFlash: (sessionId: string) => Promise<void>;
      startRtt: (
        sessionId: string,
        probe: ProbeInfo,
        config: FlashConfig,
      ) => Promise<void>;
      stopRtt: (sessionId: string) => Promise<void>;
      openFileDialog: (
        filters: Array<{ name: string; extensions: string[] }>,
      ) => Promise<string | null>;
      onFlashStatus: (
        sessionId: string,
        cb: (line: string) => void,
      ) => () => void;
      onRttData: (
        sessionId: string,
        cb: (line: string, type: RttLine['type']) => void,
      ) => () => void;
      onSessionStatus: (
        sessionId: string,
        cb: (status: string, error?: string) => void,
      ) => () => void;
    };
  }
}
