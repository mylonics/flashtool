import { spawn, type ChildProcess } from 'child_process';
import type { FlashConfig, ProbeInfo } from '../../src/types';
import type { LogFn, RttDataFn, StatusFn } from './openocd-service';
import { OpenOcdService } from './openocd-service';
import { ToolResolver } from './tool-resolver';

/**
 * STLink flash + RTT service.
 *
 * Flash options:
 *   1. st-flash CLI (default, fast):
 *      st-flash --format ihex write <file>   (for .hex)
 *      st-flash write <file> 0x8000000       (for .bin)
 *      st-flash --format elf write <file>    (for .elf)
 *
 *   2. OpenOCD (provides RTT via TCP socket):
 *      Delegates to OpenOcdService with stlink interface config.
 */
export class StlinkService {
  private flashProc: ChildProcess | null = null;
  private openocd = new OpenOcdService();

  async flash(
    probe: ProbeInfo,
    config: FlashConfig,
    log: LogFn,
    status: StatusFn,
  ): Promise<void> {
    if (config.flashTool === 'openocd') {
      return this.openocd.flash(probe, config, log, status);
    }
    return this.flashWithStFlash(config, log, status);
  }

  private async flashWithStFlash(
    config: FlashConfig,
    log: LogFn,
    status: StatusFn,
  ): Promise<void> {
    const ext = config.firmwarePath.split('.').pop()?.toLowerCase() ?? '';
    const args = this.buildStFlashArgs(config.firmwarePath, ext);
    const stFlashBin = await ToolResolver.stFlash();

    log(`[st-flash] Running: st-flash ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      this.flashProc = spawn(stFlashBin, args, { stdio: 'pipe' });

      const onData = (data: Buffer) => {
        data.toString().split('\n').forEach((l) => l && log(l));
      };

      this.flashProc.stdout?.on('data', onData);
      this.flashProc.stderr?.on('data', onData);

      this.flashProc.on('close', (code) => {
        this.flashProc = null;
        if (code === 0) {
          log('[st-flash] Flash complete.');
          status('idle');
          resolve();
        } else {
          const msg = `st-flash exited with code ${code}`;
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

  private buildStFlashArgs(firmwarePath: string, ext: string): string[] {
    if (ext === 'hex') {
      return ['--format', 'ihex', 'write', firmwarePath];
    }
    if (ext === 'elf') {
      return ['--format', 'elf', 'write', firmwarePath];
    }
    // .bin: requires base address
    return ['write', firmwarePath, '0x8000000'];
  }

  cancelFlash() {
    this.flashProc?.kill('SIGTERM');
    this.flashProc = null;
    this.openocd.cancelFlash();
  }

  /** RTT via OpenOCD (required for st-flash tool since st-flash has no RTT) */
  async startRtt(
    probe: ProbeInfo,
    config: FlashConfig,
    onData: RttDataFn,
    status: StatusFn,
  ): Promise<void> {
    // Always use openocd for RTT, even when flashing with st-flash
    const openocdConfig: FlashConfig = {
      ...config,
      openocdInterface: config.openocdInterface ?? 'interface/stlink.cfg',
    };
    return this.openocd.startRtt(probe, openocdConfig, onData, status);
  }

  stopRtt() {
    this.openocd.stopRtt();
  }

  dispose() {
    this.cancelFlash();
    this.stopRtt();
  }
}
