<template>
  <div
    ref="terminalRef"
    class="rtt-terminal"
    style="height: 100%; min-height: 300px;"
  >
    <div
      v-for="(line, i) in session?.rttLines ?? []"
      :key="i"
      :class="['rtt-line', `rtt-${line.type}`]"
    >
      <span class="rtt-timestamp">{{ formatTime(line.timestamp) }} </span>{{ line.text }}
    </div>
    <div ref="bottomRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { useSessionsStore } from '../stores/sessions';

const props = defineProps<{ sessionId: string }>();
const store = useSessionsStore();

const terminalRef = ref<HTMLDivElement | null>(null);
const bottomRef = ref<HTMLDivElement | null>(null);

const session = computed(() =>
  store.sessions.find((s) => s.id === props.sessionId),
);

// Auto-scroll to bottom when new RTT lines arrive
watch(
  () => session.value?.rttLines.length,
  async () => {
    await nextTick();
    bottomRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  },
);

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${h}:${m}:${s}.${ms}]`;
}
</script>

<style scoped>
.rtt-timestamp {
  color: #569cd6;
  font-size: 11px;
}
</style>
