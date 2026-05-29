import { onMounted, onUnmounted } from 'vue';
import { useSessionsStore } from '../stores/sessions';
import type { RttLine } from '../types';

/**
 * Connects Electron IPC events for a given session to the sessions store.
 * Should be used once per SessionPanel instance.
 */
export function useSessionIpc(sessionId: string) {
  const store = useSessionsStore();
  const cleanupFns: Array<() => void> = [];

  onMounted(() => {
    if (!window.flashToolApi) return;

    // Flash log lines
    const unsubFlash = window.flashToolApi.onFlashStatus(
      sessionId,
      (line: string) => {
        store.appendFlashLog(sessionId, line);
      },
    );
    cleanupFns.push(unsubFlash);

    // RTT data lines
    const unsubRtt = window.flashToolApi.onRttData(
      sessionId,
      (line: string, type: RttLine['type']) => {
        store.appendRttLine(sessionId, {
          timestamp: Date.now(),
          text: line,
          type,
        });
      },
    );
    cleanupFns.push(unsubRtt);

    // Session status changes
    const unsubStatus = window.flashToolApi.onSessionStatus(
      sessionId,
      (status: string, error?: string) => {
        store.setStatus(
          sessionId,
          status as Parameters<typeof store.setStatus>[1],
          error,
        );
      },
    );
    cleanupFns.push(unsubStatus);
  });

  onUnmounted(() => {
    cleanupFns.forEach((fn) => fn());
  });
}
