import { spawn, type ChildProcess } from 'child_process';
import { SerialPort } from 'serialport';
import type { FlashConfig, ProbeInfo } from '../../src/types';
import type { LogFn, RttDataFn, StatusFn } from './openocd-service';
import { ToolResolver } from './tool-resolver';

interface GdbMiToken {
  id: number;
  resolve: (result: string) => void;
  reject: (err: Error) => void;
}

/**
 * BMP flash + RTT service.
 *
 * Flash:
 *   Spawns arm-none-eabi-gdb with MI2 interface, connects to BMP GDB server
 *   via extended-remote, runs swdp_scan, attaches to target, flashes firmware,
 *   resets, then quits.
 *
 * RTT:
 *   1. Sends "monitor rtt enable" via GDB before / after flashing.
 *   2. Opens the BMP UART port (MI_01) at 115200 baud and streams data.
 */
export class BmpService {
  private gdbProc: ChildProcess | null = null;
  private rttPort: SerialPort | null = null;
  private tokenCounter = 1;
  private pendingTokens = new Map<number, GdbMiToken>();
  private miBuffer = '';

  async flash(
    probe: ProbeInfo,
    config: FlashConfig,
    log: LogFn,
    status: StatusFn,
  ): Promise<void> {
    const gdbPath = config.gdbPath ?? await ToolResolver.gdb();
    const gdbPort = probe.gdbPort ?? probe.path;
    const targetId = config.targetId ?? 1;
    const scanCmd =
      config.interface === 'jtag' ? 'monitor jtag_scan' : 'monitor swdp_scan';

    log(`[bmp] Connecting to ${gdbPort} via ${gdbPath}`);

    await this.runGdbSession(gdbPath, config.firmwarePath, gdbPort, targetId, scanCmd, config.powerOverBMP ?? false, log);

    status('idle');
    log('[bmp] Flash complete.');
  }

  private runGdbSession(
    gdbPath: string,
    firmwarePath: string,
    gdbPort: string,
    targetId: number,
    scanCmd: string,
    powerOverBMP: boolean,
    log: LogFn,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // GDB batch script for flashing
      const gdbCommands = [
        `target extended-remote ${gdbPort}`,
        ...(powerOverBMP ? ['monitor tpwr enable', 'shell sleep 0.1'] : []),
        scanCmd,
        `attach ${targetId}`,
        'set mem inaccessible-by-default off',
        `file ${firmwarePath}`,
        'load',
        'compare-sections',
        'monitor swreset',
        'detach',
        'quit',
      ];

      const args = [
        '-q',
        '--batch',
        ...gdbCommands.flatMap((cmd) => ['-ex', cmd]),
      ];

      log(`[bmp] ${gdbPath} ${args.join(' ')}`);
      this.gdbProc = spawn(gdbPath, args, { stdio: 'pipe' });

      const onData = (data: Buffer) => {
        data.toString().split('\n').forEach((l) => l && log(`[gdb] ${l}`));
      };

      this.gdbProc.stdout?.on('data', onData);
      this.gdbProc.stderr?.on('data', onData);

      this.gdbProc.on('close', (code) => {
        this.gdbProc = null;
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`GDB exited with code ${code}`));
        }
      });

      this.gdbProc.on('error', (err) => {
        this.gdbProc = null;
        reject(err);
      });
    });
  }

  cancelFlash() {
    this.gdbProc?.kill('SIGTERM');
    this.gdbProc = null;
  }

  /**
   * Start RTT by:
   * 1. Sending "monitor rtt enable" via GDB MI2
   * 2. Opening the BMP UART port (MI_01) at 115200 for RTT data
   */
  async startRtt(
    probe: ProbeInfo,
    config: FlashConfig,
    onData: RttDataFn,
    status: StatusFn,
  ): Promise<void> {
    const gdbPath = config.gdbPath ?? await ToolResolver.gdb();
    const gdbPort = probe.gdbPort ?? probe.path;
    const uartPort = probe.uartPort;

    if (!uartPort) {
      throw new Error(
        'BMP UART port (MI_01) not detected. Cannot start RTT. ' +
        'Ensure the second serial port of the BMP is accessible.',
      );
    }

    // Enable RTT on probe via GDB
    await this.enableRttViaGdb(gdbPath, gdbPort, config, onData);

    // Open UART port for RTT data
    await this.openRttSerial(uartPort, onData, status);
  }

  private enableRttViaGdb(
    gdbPath: string,
    gdbPort: string,
    config: FlashConfig,
    log: RttDataFn,
  ): Promise<void> {
    const targetId = config.targetId ?? 1;
    const scanCmd =
      config.interface === 'jtag' ? 'monitor jtag_scan' : 'monitor swdp_scan';

    return new Promise((resolve, reject) => {
      const commands = [
        `target extended-remote ${gdbPort}`,
        ...(config.powerOverBMP ? ['monitor tpwr enable'] : []),
        scanCmd,
        `attach ${targetId}`,
        'monitor rtt enable',
        // Keep GDB running so RTT stays active – we detach later via stopRtt
      ];

      const args = [
        '-q',
        '--interpreter=mi2',
        ...commands.flatMap((cmd) => ['-ex', cmd]),
      ];

      log(`[bmp] Starting GDB for RTT: ${gdbPath}`, 'info');
      this.gdbProc = spawn(gdbPath, args, { stdio: 'pipe' });

      let ready = false;
      const onLine = (line: string) => {
        log(`[gdb] ${line}`, 'info');
        // "monitor rtt enable" response signals RTT is active
        if (!ready && line.includes('rtt enable')) {
          ready = true;
          resolve();
        }
      };

      const onData = (data: Buffer) =>
        data.toString().split('\n').forEach((l) => l && onLine(l));

      this.gdbProc.stdout?.on('data', onData);
      this.gdbProc.stderr?.on('data', onData);

      this.gdbProc.on('close', (code) => {
        if (!ready) reject(new Error(`GDB exited early (code ${code})`));
      });
      this.gdbProc.on('error', (err) => {
        if (!ready) reject(err);
      });

      // Resolve after timeout even if we don't see the expected output
      setTimeout(() => {
        if (!ready) {
          ready = true;
          resolve();
        }
      }, 5000);
    });
  }

  private openRttSerial(
    portPath: string,
    onData: RttDataFn,
    status: StatusFn,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });

      port.open((err) => {
        if (err) {
          reject(new Error(`Failed to open RTT port ${portPath}: ${err.message}`));
          return;
        }

        onData(`[rtt] Opened BMP RTT port ${portPath} at 115200 baud`, 'info');
        status('rtt-active');
        this.rttPort = port;
        resolve();
      });

      let lineBuffer = '';
      port.on('data', (buf: Buffer) => {
        lineBuffer += buf.toString('utf8');
        const lines = lineBuffer.split('\n');
        // Keep incomplete last line in buffer
        lineBuffer = lines.pop() ?? '';
        lines.forEach((l) => onData(l, 'output'));
      });

      port.on('error', (err) => {
        onData(`[rtt] Serial error: ${err.message}`, 'error');
        status('error', err.message);
      });

      port.on('close', () => {
        this.rttPort = null;
        status('idle');
      });
    });
  }

  stopRtt() {
    this.rttPort?.close();
    this.rttPort = null;
    this.gdbProc?.kill('SIGTERM');
    this.gdbProc = null;
  }

  dispose() {
    this.cancelFlash();
    this.stopRtt();
  }
}
