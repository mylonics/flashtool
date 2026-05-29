import { SerialPort } from 'serialport';
import type { ProbeInfo } from '../../src/types';

// BMP: Black Magic Probe USB identifiers
const BMP_VID = '1d50';
const BMP_PID = '6018';

// STLink USB identifiers (STMicroelectronics VID, various STLink PIDs)
const STLINK_VID = '0483';
const STLINK_PIDS = new Set([
  '3748', // STLink v1
  '374b', // STLink v2
  '374d', // STLink v2-1 (no MSD)
  '374e', // STLink v3E
  '374f', // STLink v3S
  '3752', // STLink v2-1 (MSD+VCP)
  '3753', // STLink v3 (2VCP)
  '3754', // STLink v3 (bridgeboard)
]);

export class ProbeDetector {
  async detect(): Promise<ProbeInfo[]> {
    const allPorts = await SerialPort.list();
    const probes: ProbeInfo[] = [];

    // ── BMP detection ──────────────────────────────────────────────────────────
    const bmpPorts = allPorts.filter((p) => {
      const vid = (p.vendorId ?? '').toLowerCase().replace(/^0x/, '');
      const pid = (p.productId ?? '').toLowerCase().replace(/^0x/, '');
      return vid === BMP_VID && pid === BMP_PID;
    });

    if (bmpPorts.length > 0) {
      // Group by serial number so multi-interface devices are grouped
      const bySerial = new Map<string, typeof bmpPorts>();
      for (const port of bmpPorts) {
        const sn = port.serialNumber ?? 'unknown';
        if (!bySerial.has(sn)) bySerial.set(sn, []);
        bySerial.get(sn)!.push(port);
      }

      for (const [sn, ports] of bySerial) {
        // Sort by path so lowest index is first (MI_00 = GDB, MI_01 = UART/RTT)
        ports.sort((a, b) => a.path.localeCompare(b.path));

        const gdbPort = this.findBmpGdbPort(ports);
        const uartPort = this.findBmpUartPort(ports, gdbPort);

        probes.push({
          path: gdbPort?.path ?? ports[0]!.path,
          gdbPort: gdbPort?.path,
          uartPort: uartPort?.path,
          type: 'bmp',
          name: `Black Magic Probe (${gdbPort?.path ?? ports[0]!.path})`,
          serialNumber: sn !== 'unknown' ? sn : undefined,
          manufacturer: gdbPort?.manufacturer ?? 'Black Magic Debug',
        });
      }
    }

    // ── STLink detection ────────────────────────────────────────────────────────
    const stlinkPorts = allPorts.filter((p) => {
      const vid = (p.vendorId ?? '').toLowerCase().replace(/^0x/, '');
      const pid = (p.productId ?? '').toLowerCase().replace(/^0x/, '');
      return vid === STLINK_VID && STLINK_PIDS.has(pid);
    });

    // Deduplicate by serial number (STLink may appear as multiple ports)
    const stlinkBySn = new Map<string, typeof stlinkPorts[0]>();
    for (const port of stlinkPorts) {
      const sn = port.serialNumber ?? port.path;
      if (!stlinkBySn.has(sn)) stlinkBySn.set(sn, port);
    }

    for (const [sn, port] of stlinkBySn) {
      const pid = (port.productId ?? '').toLowerCase();
      const version = this.stlinkVersion(pid);
      probes.push({
        path: port.path,
        type: 'stlink',
        name: `ST-Link ${version} (${port.path})`,
        serialNumber: sn !== port.path ? sn : undefined,
        manufacturer: port.manufacturer ?? 'STMicroelectronics',
      });
    }

    return probes;
  }

  /**
   * Find the GDB port (MI_00, lower numbered path) from BMP port list.
   */
  private findBmpGdbPort(ports: Awaited<ReturnType<typeof SerialPort.list>>) {
    // Strategy 1: pnpId contains MI_00 or MI#00 (reliable on Windows)
    const byPnpId = ports.find((p) => {
      const pnpId = (p.pnpId ?? '').toUpperCase();
      return pnpId.includes('MI_00') || pnpId.includes('MI#00');
    });
    if (byPnpId) return byPnpId;

    // Strategy 2: lowest path (ports are sorted)
    return ports[0] ?? null;
  }

  /**
   * Find the UART/RTT port (MI_01, second serial port) from BMP port list.
   */
  private findBmpUartPort(
    ports: Awaited<ReturnType<typeof SerialPort.list>>,
    gdbPort: Awaited<ReturnType<typeof SerialPort.list>>[0] | null,
  ) {
    // Strategy 1: pnpId contains MI_01 or MI#01
    const byPnpId = ports.find((p) => {
      const pnpId = (p.pnpId ?? '').toUpperCase();
      return pnpId.includes('MI_01') || pnpId.includes('MI#01');
    });
    if (byPnpId) return byPnpId;

    // Strategy 2: numeric path increment (e.g. /dev/ttyACM0 → ttyACM1)
    if (gdbPort) {
      const nextPath = this.incrementPortPath(gdbPort.path);
      const byPath = ports.find((p) => p.path === nextPath);
      if (byPath) return byPath;
    }

    // Strategy 3: second port in sorted list
    if (gdbPort) {
      return ports.find((p) => p.path !== gdbPort.path) ?? null;
    }

    return ports[1] ?? null;
  }

  /**
   * Increment the trailing number of a port path.
   * e.g. /dev/ttyACM0 → /dev/ttyACM1,  COM3 → COM4
   */
  private incrementPortPath(portPath: string): string {
    return portPath.replace(/(\d+)$/, (_, n: string) => String(Number(n) + 1));
  }

  /** Human-readable STLink version from PID */
  private stlinkVersion(pid: string): string {
    if (pid === '3748') return 'v1';
    if (['374b', '374d', '3752'].includes(pid)) return 'v2';
    if (['374e', '374f', '3753', '3754'].includes(pid)) return 'v3';
    return '';
  }
}
