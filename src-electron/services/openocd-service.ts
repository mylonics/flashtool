import { spawn, type ChildProcess } from 'child_process';
import { createConnection, type Socket } from 'net';
import type { FlashConfig, ProbeInfo } from '../../src/types';

export type LogFn = (line: string) => void;
export type StatusFn = (status: string, error?: string) => void;
export type RttDataFn = (
  line: string,
  type: 'output' | 'error' | 'info',
) => void;

/**
 * OpenOCD flash + RTT service.
 *
 * Flash:
 *   openocd -f <interface> -f <target> -c "program <file> verify reset exit"
 *
 * RTT:
 *   openocd -f <interface> -f <target>
 *     -c "rtt server start 19021 0"
 *     -c "init; reset init; rtt setup auto; rtt start"
 *   Then connect to TCP 19021 for RTT channel 0 data.
 */
export class OpenOcdService {
  private flashProc: ChildProcess | null = null;
  private rttProc: ChildProcess | null = null;
  private rttSocket: Socket | null = null;
  private rttPort = 19021;

  async flash(
    probe: ProbeInfo,
    config: FlashConfig,
    log: LogFn,
    status: StatusFn,
  ): Promise<void> {
    const interfaceCfg =
      config.openocdInterface ??
      (probe.type === 'bmp' ? 'interface/cmsis-dap.cfg' : 'interface/stlink.cfg');
    const targetCfg = config.openocdTarget ?? 'board/nrf52840dk_nrf52840.cfg';

    const args = [
      '-f', interfaceCfg,
      '-f', targetCfg,
      '-c', `program ${config.firmwarePath} verify reset exit`,
    ];

    log(`[openocd] Running: openocd ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      this.flashProc = spawn('openocd', args, { stdio: 'pipe' });

      const onData = (data: Buffer) => {
        data.toString().split('\n').forEach((l) => l && log(l));
      };

      this.flashProc.stdout?.on('data', onData);
      this.flashProc.stderr?.on('data', onData);

      this.flashProc.on('close', (code) => {
        this.flashProc = null;
        if (code === 0) {
          log('[openocd] Flash complete.');
          status('idle');
          resolve();
        } else {
          const msg = `OpenOCD exited with code ${code}`;
          status('error', msg);
          reject(new Error(msg));
        }
      });

      this.flashProc.on('error', (err) => {
        this.flashProc = null;
        status('error', err.message);
        reject(err);
      });
    });
  }

  cancelFlash() {
    this.flashProc?.kill('SIGTERM');
    this.flashProc = null;
  }

  async startRtt(
    probe: ProbeInfo,
    config: FlashConfig,
    onData: RttDataFn,
    status: StatusFn,
  ): Promise<void> {
    const interfaceCfg =
      config.openocdInterface ??
      (probe.type === 'bmp' ? 'interface/cmsis-dap.cfg' : 'interface/stlink.cfg');
    const targetCfg = config.openocdTarget ?? 'board/nrf52840dk_nrf52840.cfg';
    const rttAddr = config.rttAddress && config.rttAddress !== 'auto'
      ? `rtt setup ${config.rttAddress} 0x10 "SEGGER RTT"`
      : 'rtt setup auto';

    const args = [
      '-f', interfaceCfg,
      '-f', targetCfg,
      '-c', `rtt server start ${this.rttPort} 0`,
      '-c', `init; reset init; ${rttAddr}; rtt start`,
    ];

    onData(`[openocd] Starting RTT server on port ${this.rttPort}…`, 'info');

    await new Promise<void>((resolve, reject) => {
      this.rttProc = spawn('openocd', args, { stdio: 'pipe' });

      const ready = /rtt server started/i;
      let resolved = false;

      const tryResolve = (line: string) => {
        if (!resolved && ready.test(line)) {
          resolved = true;
          resolve();
        }
      };

      const onStderr = (data: Buffer) => {
        data.toString().split('\n').forEach((l) => {
          if (!l) return;
          onData(l, 'info');
          tryResolve(l);
        });
      };

      this.rttProc.stderr?.on('data', onStderr);
      this.rttProc.stdout?.on('data', onStderr);

      this.rttProc.on('error', (err) => {
        if (!resolved) reject(err);
        status('error', err.message);
      });

      this.rttProc.on('close', (code) => {
        this.rttProc = null;
        if (!resolved) reject(new Error(`OpenOCD exited early (code ${code})`));
        status('idle');
      });

      // Timeout if OpenOCD doesn't start RTT server within 10 s
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(); // Proceed anyway – some versions have different log text
        }
      }, 10_000);
    });

    // Connect to RTT TCP socket
    await this.connectRttSocket(onData, status);
  }

  private connectRttSocket(onData: RttDataFn, status: StatusFn): Promise<void> {
    return new Promise((resolve) => {
      const tryConnect = (attempt: number) => {
        const sock = createConnection(this.rttPort, '127.0.0.1', () => {
          onData('[rtt] Connected to OpenOCD RTT server.', 'info');
          status('rtt-active');
          resolve();
        });

        sock.on('data', (buf: Buffer) => {
          const text = buf.toString('utf8');
          text.split('\n').forEach((l) => l && onData(l, 'output'));
        });

        sock.on('error', (err) => {
          if (attempt < 10) {
            setTimeout(() => tryConnect(attempt + 1), 500);
          } else {
            onData(`[rtt] Failed to connect: ${err.message}`, 'error');
            status('error', err.message);
            resolve();
          }
        });

        sock.on('close', () => {
          this.rttSocket = null;
          status('idle');
        });

        this.rttSocket = sock;
      };

      tryConnect(0);
    });
  }

  stopRtt() {
    this.rttSocket?.destroy();
    this.rttSocket = null;
    this.rttProc?.kill('SIGTERM');
    this.rttProc = null;
  }

  dispose() {
    this.cancelFlash();
    this.stopRtt();
  }
}
