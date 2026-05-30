<template>
  <div
    ref="terminalRef"
    class="rtt-terminal"
    style="height: 100%;"
  >
    <div
      v-for="(line, i) in session?.rttLines ?? []"
      :key="i"
      :class="['rtt-line', `rtt-${line.type}`]"
    >
      <span class="rtt-timestamp">{{ formatTime(line.timestamp) }} </span><span v-html="ansiToHtml(line.text)" />
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

// ANSI SGR colour codes → terminal-style colours
const ANSI_FG: Record<number, string> = {
  30: '#555', 31: '#c33', 32: '#3a3', 33: '#b80', 34: '#36c', 35: '#a3a', 36: '#3aa', 37: '#bbb',
  90: '#888', 91: '#f55', 92: '#5c5', 93: '#fd5', 94: '#57f', 95: '#d5d', 96: '#5dd', 97: '#fff',
};

function ansiToHtml(raw: string): string {
  // HTML-escape first to prevent XSS from firmware output
  let text = raw
    .replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let openSpans = 0;

  text = text.replace(/\x1b\[([0-9;]*)([A-Za-z])/g, (_m, params: string, cmd: string) => {
    if (cmd !== 'm') return ''; // strip cursor-movement and other non-colour sequences

    const codes = params === '' ? [0] : params.split(';').map(Number);
    let out = '';
    let style = '';

    if (codes.includes(0)) {
      out += '</span>'.repeat(openSpans);
      openSpans = 0;
    }

    for (const c of codes) {
      if (c === 1) style += 'font-weight:bold;';
      else if (c === 2) style += 'opacity:0.6;';
      else if (c === 3) style += 'font-style:italic;';
      else if (c === 4) style += 'text-decoration:underline;';
      else if (ANSI_FG[c] !== undefined) style += `color:${ANSI_FG[c]};`;
    }

    if (style) {
      out += `<span style="${style}">`;
      openSpans++;
    }
    return out;
  });

  return text + '</span>'.repeat(openSpans);
}
</script>

<style scoped>
.rtt-timestamp {
  color: #569cd6;
  font-size: 11px;
}
</style>
