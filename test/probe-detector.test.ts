import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the serialport module before importing the service
vi.mock('serialport', () => ({
  SerialPort: {
    list: vi.fn(),
  },
}));

import { ProbeDetector } from '../src-electron/services/probe-detector';
import { SerialPort } from 'serialport';

const mockList = SerialPort.list as ReturnType<typeof vi.fn>;

describe('ProbeDetector', () => {
  let detector: ProbeDetector;

  beforeEach(() => {
    detector = new ProbeDetector();
    mockList.mockReset();
  });

  it('returns empty array when no ports are found', async () => {
    mockList.mockResolvedValue([]);
    const probes = await detector.detect();
    expect(probes).toEqual([]);
  });

  it('detects a BMP probe by VID/PID', async () => {
    mockList.mockResolvedValue([
      {
        path: '/dev/ttyACM0',
        vendorId: '1d50',
        productId: '6018',
        serialNumber: 'DEADBEEF',
        manufacturer: 'Black Magic Debug',
        pnpId: 'USB\\VID_1D50&PID_6018&MI_00\\...',
      },
      {
        path: '/dev/ttyACM1',
        vendorId: '1d50',
        productId: '6018',
        serialNumber: 'DEADBEEF',
        manufacturer: 'Black Magic Debug',
        pnpId: 'USB\\VID_1D50&PID_6018&MI_01\\...',
      },
    ]);

    const probes = await detector.detect();
    expect(probes).toHaveLength(1);
    const bmp = probes[0]!;
    expect(bmp.type).toBe('bmp');
    expect(bmp.gdbPort).toBe('/dev/ttyACM0');
    expect(bmp.uartPort).toBe('/dev/ttyACM1');
    expect(bmp.serialNumber).toBe('DEADBEEF');
  });

  it('detects BMP gdb port via MI_00 pnpId on Windows', async () => {
    mockList.mockResolvedValue([
      {
        path: 'COM4',
        vendorId: '1D50',
        productId: '6018',
        serialNumber: 'ABC123',
        pnpId: 'USB\\VID_1D50&PID_6018&MI_01\\...',
      },
      {
        path: 'COM3',
        vendorId: '1D50',
        productId: '6018',
        serialNumber: 'ABC123',
        pnpId: 'USB\\VID_1D50&PID_6018&MI_00\\...',
      },
    ]);

    const probes = await detector.detect();
    expect(probes).toHaveLength(1);
    const bmp = probes[0]!;
    expect(bmp.gdbPort).toBe('COM3');  // MI_00 picked as GDB port
    expect(bmp.uartPort).toBe('COM4'); // MI_01 picked as UART port
  });

  it('detects a STLink v2 probe', async () => {
    mockList.mockResolvedValue([
      {
        path: '/dev/ttyACM0',
        vendorId: '0483',
        productId: '374b',
        serialNumber: 'STLINK123',
        manufacturer: 'STMicroelectronics',
      },
    ]);

    const probes = await detector.detect();
    expect(probes).toHaveLength(1);
    const stlink = probes[0]!;
    expect(stlink.type).toBe('stlink');
    expect(stlink.name).toContain('v2');
    expect(stlink.serialNumber).toBe('STLINK123');
  });

  it('detects a STLink v3 probe by PID', async () => {
    mockList.mockResolvedValue([
      {
        path: '/dev/ttyACM0',
        vendorId: '0483',
        productId: '374e',
        serialNumber: 'STLINK3',
        manufacturer: 'STMicroelectronics',
      },
    ]);

    const probes = await detector.detect();
    expect(probes).toHaveLength(1);
    expect(probes[0]!.name).toContain('v3');
  });

  it('deduplicates STLink ports with same serial number', async () => {
    mockList.mockResolvedValue([
      {
        path: '/dev/ttyACM0',
        vendorId: '0483',
        productId: '374b',
        serialNumber: 'SAME',
      },
      {
        path: '/dev/ttyACM1',
        vendorId: '0483',
        productId: '374b',
        serialNumber: 'SAME',
      },
    ]);

    const probes = await detector.detect();
    const stlinks = probes.filter((p) => p.type === 'stlink');
    expect(stlinks).toHaveLength(1);
  });

  it('handles multiple different probes simultaneously', async () => {
    mockList.mockResolvedValue([
      {
        path: '/dev/ttyACM0',
        vendorId: '1d50',
        productId: '6018',
        serialNumber: 'BMP1',
        pnpId: 'MI_00',
      },
      {
        path: '/dev/ttyACM1',
        vendorId: '1d50',
        productId: '6018',
        serialNumber: 'BMP1',
        pnpId: 'MI_01',
      },
      {
        path: '/dev/ttyACM2',
        vendorId: '0483',
        productId: '374b',
        serialNumber: 'STL1',
      },
    ]);

    const probes = await detector.detect();
    expect(probes).toHaveLength(2);
    expect(probes.some((p) => p.type === 'bmp')).toBe(true);
    expect(probes.some((p) => p.type === 'stlink')).toBe(true);
  });

  it('groups BMP ports by serial number for multi-probe setups', async () => {
    mockList.mockResolvedValue([
      {
        path: '/dev/ttyACM0',
        vendorId: '1d50',
        productId: '6018',
        serialNumber: 'BMP_A',
        pnpId: 'MI_00',
      },
      {
        path: '/dev/ttyACM1',
        vendorId: '1d50',
        productId: '6018',
        serialNumber: 'BMP_A',
        pnpId: 'MI_01',
      },
      {
        path: '/dev/ttyACM2',
        vendorId: '1d50',
        productId: '6018',
        serialNumber: 'BMP_B',
        pnpId: 'MI_00',
      },
      {
        path: '/dev/ttyACM3',
        vendorId: '1d50',
        productId: '6018',
        serialNumber: 'BMP_B',
        pnpId: 'MI_01',
      },
    ]);

    const probes = await detector.detect();
    const bmps = probes.filter((p) => p.type === 'bmp');
    expect(bmps).toHaveLength(2);
    expect(bmps[0]!.serialNumber).toBe('BMP_A');
    expect(bmps[1]!.serialNumber).toBe('BMP_B');
  });

  it('handles uppercase VID/PID from Windows', async () => {
    mockList.mockResolvedValue([
      {
        path: 'COM5',
        vendorId: '1D50',
        productId: '6018',
        serialNumber: 'WIN1',
      },
    ]);

    const probes = await detector.detect();
    expect(probes.some((p) => p.type === 'bmp')).toBe(true);
  });

  it('handles VID/PID with 0x prefix', async () => {
    mockList.mockResolvedValue([
      {
        path: '/dev/ttyACM0',
        vendorId: '0x1d50',
        productId: '0x6018',
        serialNumber: 'HEX1',
      },
    ]);

    const probes = await detector.detect();
    expect(probes.some((p) => p.type === 'bmp')).toBe(true);
  });
});
