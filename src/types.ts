// Shared types for probe and session management.
// These are used by both the renderer and main process.

export type ProbeType = 'bmp' | 'stlink' | 'openocd';
export type FlashTool = 'stlink' | 'openocd';
export type SessionStatus =
  | 'idle'
  | 'detecting'
  | 'flashing'
  | 'rtt-active'
  | 'error';

export interface ProbeInfo {
  /** Unique path/port for the probe (e.g. /dev/ttyACM0 or COM3) */
  path: string;
  /** GDB serial port (for BMP: MI_00) */
  gdbPort?: string;
  /** UART / RTT serial port (for BMP: MI_01) */
  uartPort?: string;
  type: ProbeType;
  /** Human-readable name */
  name: string;
  serialNumber?: string;
  manufacturer?: string;
}

export interface FlashConfig {
  /** Path to the ELF/HEX/BIN firmware file */
  firmwarePath: string;
  probeType: ProbeType;
  /** For BMP: override the bundled GDB (false = always use bundled/resolved GDB) */
  gdbOverride?: boolean;
  /** For BMP: custom GDB executable path or name; empty = use arm-none-eabi-gdb from system PATH */
  gdbPath?: string;
  /** For STLink: use openocd instead of st-flash */
  flashTool?: FlashTool;
  /** For OpenOCD: target config file (e.g. board/nrf52840dk_nrf52840.cfg) */
  openocdTarget?: string;
  /** For OpenOCD: interface config file */
  openocdInterface?: string;
  /** For OpenOCD: whether the user has explicitly set an interface override */
  openocdInterfaceOverride?: boolean;
  /** BMP: target index (default 1) */
  targetId?: number;
  /** BMP: use SWD (default) or JTAG */
  interface?: 'swd' | 'jtag';
  /** BMP: enable power over BMP (tpwr) */
  powerOverBMP?: boolean;
  /** BMP/OpenOCD: base load address for raw .bin files (e.g. 0x08000000) */
  flashAddress?: string;
  /** BMP: override the auto-detected UART/RTT serial port (e.g. COM6) */
  bmpUartPort?: string;
  /** RTT: base address (auto = detect from ELF symbols, or explicit address) */
  rttAddress?: string;
  /** OpenOCD RTT: start address for scanning the RTT control block */
  rttScanAddress?: string;
  /** OpenOCD RTT: size of the memory region to scan for the RTT control block */
  rttScanSize?: string;
}

export interface RttLine {
  timestamp: number;
  text: string;
  type: 'output' | 'error' | 'info';
}

export interface FlashSession {
  id: string;
  name: string;
  probe: ProbeInfo | null;
  config: FlashConfig;
  status: SessionStatus;
  flashLog: string[];
  rttLines: RttLine[];
  errorMessage?: string;
}

// IPC channel names
export const IPC = {
  PROBE_DETECT: 'probe:detect',
  FLASH_START: 'flash:start',
  FLASH_CANCEL: 'flash:cancel',
  FLASH_STATUS: 'flash:status',
  FLASH_AND_RTT_START: 'flash-and-rtt:start',
  RTT_START: 'rtt:start',
  RTT_STOP: 'rtt:stop',
  RTT_DATA: 'rtt:data',
  RTT_SEND: 'rtt:send',
  PORT_LIST: 'port:list',
  OPENOCD_CFG_LIST: 'openocd:cfg-list',
  SESSION_LIST: 'session:list',
  SESSION_CREATE: 'session:create',
  SESSION_DELETE: 'session:delete',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
