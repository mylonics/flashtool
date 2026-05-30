import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type { FlashSession, ProbeInfo, FlashConfig, RttLine } from '../types';

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<FlashSession[]>([]);
  const activeSessionId = ref<string | null>(null);

  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null,
  );

  function createSession(name?: string): FlashSession {
    const session: FlashSession = {
      id: uuidv4(),
      name: name ?? `Session ${sessions.value.length + 1}`,
      probe: null,
      config: {
        firmwarePath: '',
        probeType: 'bmp',
        gdbOverride: false,
        gdbPath: '',
        flashTool: 'stlink',
        openocdTarget: 'target/nrf52.cfg',
        openocdInterface: '',
        openocdInterfaceOverride: false,
        targetId: 1,
        interface: 'swd',
        powerOverBMP: false,
        flashAddress: '0x08000000',
        rttAddress: 'auto',
        rttScanAddress: '0x20000000',
        rttScanSize: '0x40000',
      },
      status: 'idle',
      flashLog: [],
      rttLines: [],
    };
    sessions.value.push(session);
    if (!activeSessionId.value) {
      activeSessionId.value = session.id;
    }
    return session;
  }

  function deleteSession(id: string) {
    const idx = sessions.value.findIndex((s) => s.id === id);
    if (idx !== -1) {
      sessions.value.splice(idx, 1);
    }
    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value[0]?.id ?? null;
    }
  }

  function setActiveSession(id: string) {
    activeSessionId.value = id;
  }

  function updateProbe(sessionId: string, probe: ProbeInfo | null) {
    const s = sessions.value.find((x) => x.id === sessionId);
    if (s) {
      s.probe = probe;
      if (probe) {
        s.config.probeType = probe.type;
        if (probe.type === 'stlink' && s.config.flashTool !== 'openocd') {
          s.config.flashTool = 'openocd';
        }
      }
    }
  }

  function updateConfig(sessionId: string, config: Partial<FlashConfig>) {
    const s = sessions.value.find((x) => x.id === sessionId);
    if (s) {
      Object.assign(s.config, config);
    }
  }

  function setStatus(
    sessionId: string,
    status: FlashSession['status'],
    error?: string,
  ) {
    const s = sessions.value.find((x) => x.id === sessionId);
    if (s) {
      s.status = status;
      if (error !== undefined) s.errorMessage = error;
    }
  }

  function appendFlashLog(sessionId: string, line: string) {
    const s = sessions.value.find((x) => x.id === sessionId);
    if (s) {
      s.flashLog.push(line);
      // Keep log manageable
      if (s.flashLog.length > 2000) s.flashLog.splice(0, 200);
    }
  }

  function appendRttLine(sessionId: string, line: RttLine) {
    const s = sessions.value.find((x) => x.id === sessionId);
    if (s) {
      s.rttLines.push(line);
      // Keep RTT lines manageable
      if (s.rttLines.length > 5000) s.rttLines.splice(0, 500);
    }
  }

  function clearRtt(sessionId: string) {
    const s = sessions.value.find((x) => x.id === sessionId);
    if (s) s.rttLines = [];
  }

  function clearFlashLog(sessionId: string) {
    const s = sessions.value.find((x) => x.id === sessionId);
    if (s) s.flashLog = [];
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    deleteSession,
    setActiveSession,
    updateProbe,
    updateConfig,
    setStatus,
    appendFlashLog,
    appendRttLine,
    clearRtt,
    clearFlashLog,
  };
});
