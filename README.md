# flashtool
BMP, OpenOCD, and Stlink supported flashing

A cross-platform Electron + Quasar desktop application for flashing and real-time debugging of embedded targets using:

- **Black Magic Probe (BMP)** — auto-detected via USB VID `1d50` / PID `6018`
- **ST-Link** (v1/v2/v3) — auto-detected via USB VID `0483`
- **OpenOCD** — for nRF and other targets with configurable interface/target configs

## Features

- 🔌 **Auto-detection** of BMP and ST-Link probes (USB serial port scanning)
- ⚡ **Flash firmware** (.elf / .hex / .bin) using:
  - BMP: `arm-none-eabi-gdb` with MI2 over extended-remote
  - ST-Link: `st-flash` CLI or OpenOCD
  - OpenOCD: `openocd -c "program … verify reset exit"`
- 📡 **RTT (Real-Time Transfer)** output for all three probe types:
  - BMP: streams the second serial port (MI_01) at 115200 baud after `monitor rtt enable`
  - ST-Link / OpenOCD: connects to OpenOCD RTT TCP server (port 19021)
- 🪟 **Multiple concurrent sessions** — open independent RTT feeds per probe simultaneously
- 🖥️ **Session tabs** with status badges (idle / flashing / RTT active / error)

## Prerequisites

Install the relevant flash tools on your PATH:

| Probe type | Tool needed |
|---|---|
| BMP | `arm-none-eabi-gdb` (ARM GNU Toolchain) |
| ST-Link (st-flash) | [stlink tools](https://github.com/stlink-org/stlink) |
| ST-Link / OpenOCD | [OpenOCD](https://github.com/zephyrproject-rtos/openocd) |
| OpenOCD target | OpenOCD with your target config |

## Development

```bash
# Install dependencies
npm install

# Start development server (Electron)
npm run dev

# Build for production
npm run build

# Run unit tests
npm test

# Lint
npm run lint
```

## Architecture

```
src/                          # Quasar (Vue 3 + TypeScript) renderer
  components/
    SessionPanel.vue          # Per-session container (probe + flash + RTT)
    ProbeSelector.vue         # Probe auto-detection & selection UI
    FlashPanel.vue            # Flash config & controls
    RttTerminal.vue           # Scrolling RTT output terminal
  composables/
    useSessionIpc.ts          # Bridges Electron IPC events → Pinia store
  stores/sessions.ts          # Pinia store: sessions, RTT lines, flash log
  pages/IndexPage.vue         # Session tabs

src-electron/                 # Electron main process (Node.js)
  electron-main.ts            # IPC handler registration, BrowserWindow
  electron-preload.ts         # contextBridge API exposed to renderer
  services/
    probe-detector.ts         # USB serial scan (BMP VID/PID, STLink VID/PID)
    bmp-service.ts            # BMP flash (GDB batch) + RTT (serial port MI_01)
    stlink-service.ts         # ST-Link flash (st-flash or openocd)
    openocd-service.ts        # OpenOCD flash + RTT TCP socket
    session-manager.ts        # Multi-session lifecycle management
```

## OpenOCD RTT target configuration

For nRF52840 targets with ST-Link, set in the Flash Configuration panel:

- **OpenOCD Interface**: `interface/stlink.cfg`
- **OpenOCD Target**: `board/nrf52840dk_nrf52840.cfg`

RTT data streams in via TCP port `19021` (OpenOCD RTT server).

## BMP RTT

BMP RTT uses the second serial port exposed by the probe (MI_01 / `ttyACM1`).  
The probe streams RTT data automatically after `monitor rtt enable` is sent to GDB.
