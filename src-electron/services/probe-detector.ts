import { exec } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { SerialPort } from 'serialport';
import type { ProbeInfo } from '../../src/types';

const execAsync = promisify(exec);

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
    const [allPorts, usbStlinks] = await Promise.all([
      SerialPort.list(),
      this.detectStlinkViaUsb(),
    ]);
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

      const bmpProbeList: ProbeInfo[] = [];

      for (const [sn, ports] of bySerial) {
        // Sort by path so lowest index is first (MI_00 = GDB, MI_01 = UART/RTT)
        ports.sort((a, b) => a.path.localeCompare(b.path));

        const gdbPort = this.findBmpGdbPort(ports);

        // Skip groups where the primary port is the UART interface (MI_01).
        // These will be picked up as the uartPort of the GDB-port probe.
        const primaryPnpId = ((gdbPort ?? ports[0])?.pnpId ?? '').toUpperCase();
        if (primaryPnpId.includes('MI_01') || primaryPnpId.includes('MI#01')) {
          continue;
        }

        // For the UART search, expand candidates to ALL ports that share the same
        // serial number (not just those matching BMP VID/PID). Some BMP firmware
        // versions expose the two CDC interfaces with slightly different descriptors
        // so the UART port may not appear in the VID/PID-filtered list.
        const uartCandidates =
          sn !== 'unknown'
            ? allPorts
                .filter((p) => (p.serialNumber ?? 'unknown') === sn)
                .sort((a, b) => a.path.localeCompare(b.path))
            : ports;

        const uartPort = this.findBmpUartPort(uartCandidates, gdbPort, allPorts);

        bmpProbeList.push({
          path: gdbPort?.path ?? ports[0]!.path,
          gdbPort: gdbPort?.path,
          uartPort: uartPort?.path,
          type: 'bmp',
          name: `Black Magic Probe (${gdbPort?.path ?? ports[0]!.path})`,
          serialNumber: sn !== 'unknown' ? sn : undefined,
          manufacturer: gdbPort?.manufacturer ?? 'Black Magic Debug',
        });
      }

      // Fallback merge: if two probes have adjacent COM ports and the lower one
      // has no uartPort yet, absorb the higher one as its UART port. This handles
      // the case where each CDC interface gets a different serial number so they
      // ended up as separate groups above.
      bmpProbeList.sort((a, b) => (a.gdbPort ?? a.path).localeCompare(b.gdbPort ?? b.path));
      for (let i = 0; i < bmpProbeList.length - 1; i++) {
        const curr = bmpProbeList[i]!;
        const next = bmpProbeList[i + 1]!;
        if (
          curr.gdbPort &&
          next.gdbPort &&
          !curr.uartPort &&
          this.incrementPortPath(curr.gdbPort) === next.gdbPort
        ) {
          curr.uartPort = next.gdbPort;
          bmpProbeList.splice(i + 1, 1);
          i -= 1;
        }
      }

      probes.push(...bmpProbeList);
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

    const stlinkSnSeen = new Set<string>();
    for (const [sn, port] of stlinkBySn) {
      const pid = (port.productId ?? '').toLowerCase();
      const version = this.stlinkVersion(pid);
      const serialNumber = sn !== port.path ? sn : undefined;
      if (serialNumber) stlinkSnSeen.add(serialNumber);
      probes.push({
        path: port.path,
        type: 'stlink',
        name: `ST-Link ${version} (${port.path})`,
        serialNumber,
        manufacturer: port.manufacturer ?? 'STMicroelectronics',
      });
    }

    // Add USB-detected STLink probes not already found via VCP serial port
    for (const usbProbe of usbStlinks) {
      if (usbProbe.serialNumber && stlinkSnSeen.has(usbProbe.serialNumber)) continue;
      probes.push(usbProbe);
    }

    return probes;
  }

  /**
   * Detect STLink probes at the USB level (no VCP required).
   * STLink v2 (PID 374b) has no virtual COM port, so SerialPort.list() misses it.
   */
  private async detectStlinkViaUsb(): Promise<ProbeInfo[]> {
    try {
      switch (process.platform) {
        case 'win32': return await this.detectStlinkWindows();
        case 'linux': return await this.detectStlinkLinux();
        case 'darwin': return await this.detectStlinkMac();
        default: return [];
      }
    } catch {
      return [];
    }
  }

  private async detectStlinkWindows(): Promise<ProbeInfo[]> {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "Get-PnpDevice -PresentOnly | ' +
        "Where-Object InstanceId -like '*VID_0483*' | " +
        "Where-Object Status -eq 'OK' | " +
        'Select-Object FriendlyName, InstanceId | ConvertTo-Json -Compress"',
    );
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === 'null') return [];

    type WinDev = { FriendlyName: string; InstanceId: string };
    const raw = JSON.parse(trimmed) as WinDev | WinDev[];
    const devices: WinDev[] = Array.isArray(raw) ? raw : [raw];

    const bySn = new Map<string, ProbeInfo>();
    for (const dev of devices) {
      // InstanceId: USB\VID_0483&PID_374B\5A002900...
      const m = /PID_([0-9A-Fa-f]+)\\(.+)$/i.exec(dev.InstanceId);
      if (!m) continue;
      const pid = (m[1] ?? '').toLowerCase();
      const sn = m[2] ?? '';
      if (!STLINK_PIDS.has(pid) || bySn.has(sn)) continue;
      const version = this.stlinkVersion(pid);
      bySn.set(sn, {
        path: sn,
        type: 'stlink',
        name: `ST-Link ${version} (${sn})`,
        serialNumber: sn || undefined,
        manufacturer: 'STMicroelectronics',
      });
    }
    return [...bySn.values()];
  }

  private async detectStlinkLinux(): Promise<ProbeInfo[]> {
    const sysPath = '/sys/bus/usb/devices';
    const dirs = await readdir(sysPath);
    const bySn = new Map<string, ProbeInfo>();

    await Promise.all(
      dirs.map(async (dir) => {
        const base = path.join(sysPath, dir);
        try {
          const [vid, pid] = await Promise.all([
            readFile(path.join(base, 'idVendor'), 'utf8').then((s) => s.trim()),
            readFile(path.join(base, 'idProduct'), 'utf8').then((s) => s.trim()),
          ]);
          if (vid !== '0483' || !STLINK_PIDS.has(pid)) return;
          const serial = await readFile(path.join(base, 'serial'), 'utf8')
            .then((s) => s.trim())
            .catch(() => dir);
          if (bySn.has(serial)) return;
          const version = this.stlinkVersion(pid);
          bySn.set(serial, {
            path: serial,
            type: 'stlink',
            name: `ST-Link ${version} (${serial})`,
            serialNumber: serial !== dir ? serial : undefined,
            manufacturer: 'STMicroelectronics',
          });
        } catch { /* not a USB device dir */ }
      }),
    );
    return [...bySn.values()];
  }

  private async detectStlinkMac(): Promise<ProbeInfo[]> {
    const { stdout } = await execAsync('system_profiler SPUSBDataType -json');
    interface SpUsbDevice {
      _name: string;
      vendor_id?: string;
      product_id?: string;
      serial_num?: string;
      manufacturer?: string;
      _items?: SpUsbDevice[];
    }
    const data = JSON.parse(stdout) as { SPUSBDataType: SpUsbDevice[] };
    const probes: ProbeInfo[] = [];

    const walk = (devices: SpUsbDevice[]) => {
      for (const dev of devices) {
        const vid = (dev.vendor_id ?? '').toLowerCase().replace('0x', '').padStart(4, '0');
        const pid = (dev.product_id ?? '').toLowerCase().replace('0x', '').padStart(4, '0');
        if (vid === '0483' && STLINK_PIDS.has(pid)) {
          const serial = dev.serial_num ?? '';
          const version = this.stlinkVersion(pid);
          probes.push({
            path: serial || dev._name,
            type: 'stlink',
            name: `ST-Link ${version} (${serial || dev._name})`,
            serialNumber: serial || undefined,
            manufacturer: dev.manufacturer ?? 'STMicroelectronics',
          });
        }
        if (dev._items) walk(dev._items);
      }
    };
    walk(data.SPUSBDataType ?? []);
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
    allPorts?: Awaited<ReturnType<typeof SerialPort.list>>,
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

    // Strategy 4: adjacent COM port in ALL ports (last-resort when UART port
    // doesn't share serial number / VID-PID with the GDB port)
    if (gdbPort && allPorts) {
      const nextPath = this.incrementPortPath(gdbPort.path);
      const anyNext = allPorts.find((p) => p.path === nextPath);
      if (anyNext) return anyNext;
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
