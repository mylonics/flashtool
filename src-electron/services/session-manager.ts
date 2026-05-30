import type { FlashConfig, ProbeInfo } from '../../src/types';
import { BmpService } from './bmp-service';
import { StlinkService } from './stlink-service';
import { OpenOcdService } from './openocd-service';
import type { RttDataFn, StatusFn, LogFn } from './openocd-service';


interface Session {
  id: string;
  bmp?: BmpService;
  stlink?: StlinkService;
  openocd?: OpenOcdService;
}

/**
 * Manages multiple flash/RTT sessions, one per connected probe.
 * Each session owns its own service instances to support concurrency.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();

  private getOrCreate(sessionId: string): Session {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { id: sessionId });
    }
    return this.sessions.get(sessionId)!;
  }

  async flash(
    sessionId: string,
    probe: ProbeInfo,
    config: FlashConfig,
    log: LogFn,
    status: StatusFn,
  ): Promise<void> {
    const session = this.getOrCreate(sessionId);

    if (probe.type === 'bmp') {
      session.bmp ??= new BmpService();
      return session.bmp.flash(probe, config, log, status);
    }

    if (probe.type === 'stlink') {
      session.stlink ??= new StlinkService();
      return session.stlink.flash(probe, config, log, status);
    }

    // openocd probe
    session.openocd ??= new OpenOcdService();
    return session.openocd.flash(probe, config, log, status);
  }

  cancelFlash(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.bmp?.cancelFlash();
    session.stlink?.cancelFlash();
    session.openocd?.cancelFlash();
  }

  async startRtt(
    sessionId: string,
    probe: ProbeInfo,
    config: FlashConfig,
    onData: RttDataFn,
    status: StatusFn,
  ): Promise<void> {
    const session = this.getOrCreate(sessionId);

    if (probe.type === 'bmp') {
      session.bmp ??= new BmpService();
      return session.bmp.startRtt(probe, config, onData, status);
    }

    if (probe.type === 'stlink') {
      session.stlink ??= new StlinkService();
      return session.stlink.startRtt(probe, config, onData, status);
    }

    // openocd probe
    session.openocd ??= new OpenOcdService();
    return session.openocd.startRtt(probe, config, onData, status);
  }

  /**
   * Flash + RTT in a single GDB session (BMP only).
   * For non-BMP probes, falls back to sequential flash then RTT.
   */
  async flashAndStartRtt(
    sessionId: string,
    probe: ProbeInfo,
    config: FlashConfig,
    log: LogFn,
    onData: RttDataFn,
    status: StatusFn,
  ): Promise<void> {
    const session = this.getOrCreate(sessionId);

    if (probe.type === 'bmp') {
      session.bmp ??= new BmpService();
      return session.bmp.flashAndStartRtt(probe, config, log, onData, status);
    }

    // Non-BMP fallback: sequential flash then RTT (separate processes, same as before).
    if (probe.type === 'stlink') {
      session.stlink ??= new StlinkService();
      await session.stlink.flash(probe, config, log, status);
      return session.stlink.startRtt(probe, config, onData, status);
    }

    session.openocd ??= new OpenOcdService();
    await session.openocd.flash(probe, config, log, status);
    return session.openocd.startRtt(probe, config, onData, status);
  }

  stopRtt(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.bmp?.stopRtt();
    session.stlink?.stopRtt();
    session.openocd?.stopRtt();
  }

  disposeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.bmp?.dispose();
    session.stlink?.dispose();
    session.openocd?.dispose();
    this.sessions.delete(sessionId);
  }

  disposeAll() {
    for (const sessionId of this.sessions.keys()) {
      this.disposeSession(sessionId);
    }
  }
}
