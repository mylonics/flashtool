import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { SerialPort } from 'serialport';
import type { FlashConfig, ProbeInfo } from '../../src/types';
import type { LogFn, RttDataFn, StatusFn } from './openocd-service';
import { ToolResolver } from './tool-resolver';

/**
 * Matches the GDB interactive prompt: "(gdb) " (with optional trailing whitespace/CR).
 * GDB outputs this after startup and after every command completes.
 */
const GDB_PROMPT_RE = /\(gdb\)[ \t\r]*$/;

/** Default timeout waiting for a (gdb) prompt after a command. */
const CMD_TIMEOUT_MS = 30_000;

/** Extended timeout for flash operations (load/compare-sections can be slow). */
const FLASH_CMD_TIMEOUT_MS = 120_000;

/**
 * BMP flash + RTT service.
 *
 * All three modes share a single interactive GDB process per session:
 *
 *   Flash        — connect → scan → attach → load → reset → detach → quit
 *   Flash + RTT  — connect → scan → attach → load → reset → rtt enable → keep alive → open UART
 *   RTT Only     — connect → scan → attach → rtt enable → keep alive → open UART
 *
 * GDB is spawned once in interactive (CLI) mode. Commands are sent via stdin
 * one at a time and we wait for the "(gdb) " prompt before sending the next,
 * giving full control over the session without relying on --batch or MI2.
 */
export class BmpService {
  private gdbProc: ChildProcess | null = null;
  private rttPort: SerialPort | null = null;

  /** Accumulated stdout from GDB since the last prompt was consumed. */
  private stdoutBuf = '';

  /**
   * Queue of resolver functions each waiting for the next "(gdb) " prompt.
   * Resolved with all output accumulated since the command was sent.
   */
  private promptResolvers: Array<(output: string) => void> = [];

  // ─── GDB Process Management ──────────────────────────────────────────────

  private async resolveGdbPath(config: FlashConfig): Promise<string> {
    if (config.gdbOverride) {
      return config.gdbPath?.trim() || 'arm-none-eabi-gdb';
    }
    return ToolResolver.gdb();
  }

  /**
   * Spawn GDB in interactive mode.  Waits for the initial "(gdb) " prompt
   * before resolving.  If a previous GDB process is still alive it is killed
   * first so there is never more than one GDB session per BmpService instance.
   */
  private async spawnGdb(gdbPath: string, log: LogFn): Promise<void> {
    // Ensure any prior process is gone before starting a new one.
    if (this.gdbProc) {
      log('[bmp] Stopping existing GDB session before starting new one.');
      const waitPrev = new Promise<void>((res) => {
        this.gdbProc!.once('close', () => res());
      });
      this.gdbProc.kill('SIGTERM');
      await waitPrev;
      this.gdbProc = null;
    }

    return new Promise((resolve, reject) => {
      log(`[bmp] Starting GDB: ${gdbPath}`);
      this.stdoutBuf = '';
      this.promptResolvers = [];

      const proc = spawn(gdbPath, ['-q'], {
        stdio: 'pipe',
        windowsHide: true,
      });
      this.gdbProc = proc;

      proc.stdout?.setEncoding('utf8');
      proc.stdout?.on('data', (chunk: string) => {
        this.stdoutBuf += chunk;

        // Log each complete line; incomplete last segment stays in buffer.
        const lines = chunk.split('\n');
        const incomplete = lines.pop() ?? '';
        lines.forEach((l) => { if (l.trim()) log(`[gdb] ${l.replace(/\r$/, '')}`); });
        // If the incomplete segment is the prompt, log it too.
        if (GDB_PROMPT_RE.test(incomplete)) {
          log(`[gdb] ${incomplete.trim()}`);
        }

        // Fire the next waiting resolver once a prompt appears at the end.
        if (GDB_PROMPT_RE.test(this.stdoutBuf)) {
          const output = this.stdoutBuf;
          this.stdoutBuf = '';
          this.promptResolvers.shift()?.(output);
        }
      });

      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (chunk: string) => {
        chunk.split('\n').forEach((l) => { if (l.trim()) log(`[gdb] ${l.replace(/\r$/, '')}`); });
      });

      proc.on('error', (err: Error & { code?: string }) => {
        if (this.gdbProc === proc) this.gdbProc = null;
        this.drainResolvers();
        const message = err.code === 'ENOENT'
          ? `GDB executable not found: "${gdbPath}"\n` +
            `Enable "Override GDB executable" in BMP options, or install arm-none-eabi-gdb on PATH.`
          : err.message;
        reject(new Error(message));
      });

      proc.on('close', () => {
        if (this.gdbProc === proc) this.gdbProc = null;
        this.drainResolvers();
      });

      // Wait for the initial "(gdb) " prompt with a generous timeout.
      let initialDone = false;
      const timer = setTimeout(() => {
        if (!initialDone) {
          initialDone = true;
          // Remove from queue and resolve anyway — GDB started but prompt didn't arrive.
          const idx = this.promptResolvers.indexOf(initialResolver);
          if (idx !== -1) this.promptResolvers.splice(idx, 1);
          resolve();
        }
      }, 10_000);

      const initialResolver = (_output: string) => {
        if (!initialDone) {
          initialDone = true;
          clearTimeout(timer);
          resolve();
        }
      };
      this.promptResolvers.push(initialResolver);
    });
  }

  /**
   * Send one command to the running GDB process and wait for the next
   * "(gdb) " prompt.  Returns all output GDB produced for that command.
   */
  private sendGdbCommand(cmd: string, timeoutMs = CMD_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.gdbProc) {
        reject(new Error('GDB is not running'));
        return;
      }

      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.promptResolvers.indexOf(resolver);
        if (idx !== -1) this.promptResolvers.splice(idx, 1);
        reject(new Error(`GDB command timed out after ${timeoutMs}ms: ${cmd}`));
      }, timeoutMs);

      const resolver = (output: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(output);
      };

      this.promptResolvers.push(resolver);
      this.gdbProc.stdin?.write(cmd + '\n');
    });
  }

  /** Wait for the GDB process to exit cleanly.  Used after sending "quit". */
  private waitForGdbExit(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = this.gdbProc;
      if (!proc) { resolve(); return; }
      proc.once('close', (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`GDB exited with code ${code}`));
      });
    });
  }

  /**
   * Send "quit" then wait for the process to exit.
   * GDB does not emit a prompt after quit so we just wait for close.
   */
  private async quitGdb(): Promise<void> {
    if (!this.gdbProc) return;
    const exitPromise = this.waitForGdbExit();
    this.gdbProc.stdin?.write('quit\n');
    await exitPromise;
  }

  /**
   * Immediately terminate GDB and drain any waiting resolvers.
   * Safe to call even if GDB is not running.
   */
  private killGdb(): void {
    const proc = this.gdbProc;
    this.gdbProc = null;
    this.drainResolvers();
    if (proc) {
      try { proc.stdin?.write('quit\n'); } catch { /* ignore */ }
      setTimeout(() => { try { proc.kill('SIGTERM'); } catch { /* ignore */ } }, 500);
    }
  }

  /**
   * Throw a clear error if BMP's response to 'monitor rtt enable' indicates
   * the command is not supported.  This happens when:
   *  - The BMP firmware predates RTT support (< v1.10), OR
   *  - The command was sent after the RSP connection was already lost
   *    (e.g. after monitor swreset dropped the link).
   */
  private assertRttSupported(output: string): void {
    if (/does not support|not supported/i.test(output)) {
      throw new Error(
        'BMP reported RTT is not supported.\n' +
        'Make sure your BMP firmware is v1.10 or later and has RTT compiled in.\n' +
        'If you just flashed, try enabling RTT before the hardware reset.',
      );
    }
  }

  /** Resolve all pending prompt waiters with empty output (process is gone). */
  private drainResolvers(): void {
    const pending = this.promptResolvers.splice(0);
    pending.forEach((r) => r(''));
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Flash firmware only.  A single interactive GDB session connects, loads
   * the firmware, resets the target, then quits cleanly.
   */
  async flash(
    probe: ProbeInfo,
    config: FlashConfig,
    log: LogFn,
    status: StatusFn,
  ): Promise<void> {
    const gdbPath = await this.resolveGdbPath(config);
    const gdbPort = probe.gdbPort ?? probe.path;
    const targetId = config.targetId ?? 1;
    const scanCmd = config.interface === 'jtag' ? 'monitor jtag_scan' : 'monitor swdp_scan';

    log(`[bmp] Flash via ${gdbPath} on ${gdbPort}`);
    await this.spawnGdb(gdbPath, log);

    try {
      await this.sendGdbCommand('set confirm off');
      await this.sendGdbCommand(`target extended-remote ${gdbPort}`);
      if (config.powerOverBMP) await this.sendGdbCommand('monitor tpwr enable');
      await this.sendGdbCommand(scanCmd);
      await this.sendGdbCommand(`attach ${targetId}`);
      await this.sendGdbCommand('set mem inaccessible-by-default off');

      for (const cmd of this.buildLoadCommands(config.firmwarePath, config.flashAddress ?? '0x08000000')) {
        await this.sendGdbCommand(cmd, FLASH_CMD_TIMEOUT_MS);
      }

      // monitor swreset drops the RSP connection (BMP resets the MCU).
      // Do NOT send detach after it — the connection is already gone.
      // GDB's quit will clean up the session.
      await this.sendGdbCommand('monitor swreset');
      await this.quitGdb();
    } catch (err) {
      this.killGdb();
      throw err;
    }

    status('idle');
    log('[bmp] Flash complete.');
  }

  /**
   * Flash firmware and then enable RTT — all within ONE GDB session.
   * After flashing the GDB session stays alive (RTT requires an active GDB
   * connection on BMP).  The BMP UART port is opened for RTT data streaming.
   */
  async flashAndStartRtt(
    probe: ProbeInfo,
    config: FlashConfig,
    log: LogFn,
    onData: RttDataFn,
    status: StatusFn,
  ): Promise<void> {
    const gdbPath = await this.resolveGdbPath(config);
    const gdbPort = probe.gdbPort ?? probe.path;
    const targetId = config.targetId ?? 1;
    const scanCmd = config.interface === 'jtag' ? 'monitor jtag_scan' : 'monitor swdp_scan';

    log(`[bmp] Flash+RTT via ${gdbPath} on ${gdbPort}`);
    await this.spawnGdb(gdbPath, log);

    try {
      await this.sendGdbCommand('set confirm off');
      await this.sendGdbCommand(`target extended-remote ${gdbPort}`);
      if (config.powerOverBMP) await this.sendGdbCommand('monitor tpwr enable');
      await this.sendGdbCommand(scanCmd);
      await this.sendGdbCommand(`attach ${targetId}`);
      await this.sendGdbCommand('set mem inaccessible-by-default off');

      for (const cmd of this.buildLoadCommands(config.firmwarePath, config.flashAddress ?? '0x08000000')) {
        await this.sendGdbCommand(cmd, FLASH_CMD_TIMEOUT_MS);
      }

      // Enable RTT BEFORE resetting the target.
      // After monitor swreset, BMP drops the RSP connection (MCU reboots).
      // Sending monitor rtt enable after the reset would target a dead connection.
      log('[bmp] Enabling RTT...');
      this.assertRttSupported(await this.sendGdbCommand('monitor rtt enable'));
      log('[bmp] RTT enabled. Starting target...');

      // Fire 'run' to reset the MCU and start execution from the entry point.
      // We do NOT await a GDB prompt here — after run, the target is executing
      // and GDB won't return to the prompt until a breakpoint fires (which we
      // have none).  GDB stays alive keeping the BMP RTT session open.
      this.gdbProc?.stdin?.write('run\n');
    } catch (err) {
      this.killGdb();
      throw err;
    }

    // GDB stays running; log any unexpected exit.
    this.gdbProc?.once('close', (code) => {
      onData(`[bmp] GDB session ended (exit code ${code})`, 'info');
    });

    const uartPort = config.bmpUartPort?.trim() || probe.uartPort;
    if (!uartPort) {
      this.killGdb();
      throw new Error(
        'BMP UART port (MI_01) not detected. Cannot start RTT. ' +
        'Ensure the second BMP serial port is accessible, or set it manually.',
      );
    }

    await this.openRttSerial(uartPort, onData, status);
  }

  /**
   * Attach to a running target and enable RTT (no flashing).
   * Uses the same single-session pattern: one GDB process stays alive.
   */
  async startRtt(
    probe: ProbeInfo,
    config: FlashConfig,
    onData: RttDataFn,
    status: StatusFn,
  ): Promise<void> {
    const log: LogFn = (line) => onData(line, 'info');
    const gdbPath = await this.resolveGdbPath(config);
    const gdbPort = probe.gdbPort ?? probe.path;
    const targetId = config.targetId ?? 1;
    const scanCmd = config.interface === 'jtag' ? 'monitor jtag_scan' : 'monitor swdp_scan';

    onData(`[bmp] RTT via ${gdbPath} on ${gdbPort}`, 'info');
    await this.spawnGdb(gdbPath, log);

    try {
      await this.sendGdbCommand('set confirm off');
      await this.sendGdbCommand(`target extended-remote ${gdbPort}`);
      if (config.powerOverBMP) await this.sendGdbCommand('monitor tpwr enable');
      await this.sendGdbCommand(scanCmd);
      await this.sendGdbCommand(`attach ${targetId}`);
      await this.sendGdbCommand('set mem inaccessible-by-default off');

      // Load ELF symbols without flashing so GDB can answer BMP's qSymbol
      // request for _SEGGER_RTT.  Without this, BMP falls back to a RAM scan
      // which may fail silently, resulting in no RTT data.
      if (config.firmwarePath?.trim()) {
        const quoted = `"${config.firmwarePath.replace(/\\/g, '/')}"`;
        await this.sendGdbCommand(`file ${quoted}`);
      }

      // Enable RTT while the target is halted.
      this.assertRttSupported(await this.sendGdbCommand('monitor rtt enable'));
      onData('[bmp] RTT enabled. Resetting and starting target...', 'info');

      // 'run' resets the MCU (without reflashing) and starts from the reset
      // vector — the same sequence used by Flash+RTT (confirmed working).
      // 'continue'/'detach' do not trigger BMP's RTT polling on nRF52 targets.
      // GDB won't return a prompt while the target is executing.
      this.gdbProc?.stdin?.write('run\n');
    } catch (err) {
      this.killGdb();
      throw err;
    }

    this.gdbProc?.once('close', (code) => {
      onData(`[bmp] GDB session ended (exit code ${code})`, 'info');
    });

    const uartPort = config.bmpUartPort?.trim() || probe.uartPort;
    if (!uartPort) {
      this.killGdb();
      throw new Error(
        'BMP UART port (MI_01) not detected. Cannot start RTT. ' +
        'Ensure the second BMP serial port is accessible, or set it manually.',
      );
    }

    await this.openRttSerial(uartPort, onData, status);
  }

  cancelFlash(): void {
    this.killGdb();
  }

  stopRtt(): void {
    this.rttPort?.close();
    this.rttPort = null;
    this.killGdb();
  }

  dispose(): void {
    this.stopRtt();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Build the GDB load commands for the given firmware file format. */
  private buildLoadCommands(firmwarePath: string, flashAddress: string): string[] {
    const quoted = `"${firmwarePath.replace(/\\/g, '/')}"`;
    const ext = path.extname(firmwarePath).toLowerCase();
    if (ext === '.bin') {
      return [`restore ${quoted} binary ${flashAddress}`];
    }
    return [`file ${quoted}`, 'load', 'compare-sections'];
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
}
