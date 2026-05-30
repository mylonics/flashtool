<template>
  <div class="session-layout">
    <!-- Left: probe + config, fixed width, scrollable -->
    <div class="session-left">
      <q-card flat bordered class="q-mb-md">
        <q-card-section class="q-pb-none">
          <div class="text-subtitle1">Probe</div>
        </q-card-section>
        <q-card-section>
          <ProbeSelector :session-id="sessionId" />
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="q-pb-none">
          <div class="text-subtitle1">Flash Configuration</div>
        </q-card-section>
        <q-card-section>
          <FlashPanel :session-id="sessionId" />
        </q-card-section>
      </q-card>
    </div>

    <!-- Right: combined output, fills remaining space -->
    <div class="session-right">
      <q-card flat bordered class="output-card">
        <!-- Toolbar -->
        <div class="row items-center no-wrap q-px-sm" style="min-height: 44px;">
          <q-tabs v-model="outputTab" dense align="left" class="col" indicator-color="primary">
            <q-tab name="flashlog" icon="terminal" label="Flash Log" />
            <q-tab name="rtt" icon="bolt" label="RTT" />
          </q-tabs>
          <q-badge :color="statusColor" :label="statusLabel" class="q-mx-sm" />
          <q-btn flat dense round icon="delete_sweep" title="Clear current tab" @click="clearOutput" />
        </div>
        <q-separator />

        <!-- Error banner -->
        <q-banner
          v-if="session?.status === 'error'"
          inline-actions
          class="text-white bg-negative"
          dense
        >
          {{ session?.errorMessage }}
        </q-banner>

        <!-- Tab panels -->
        <div class="output-panels">
          <div v-show="outputTab === 'flashlog'" class="output-panel">
            <div ref="flashLogRef" class="flash-log">
              <div v-for="(line, i) in session?.flashLog ?? []" :key="i">{{ line }}</div>
              <div ref="flashLogBottomRef" />
            </div>
          </div>
          <div v-show="outputTab === 'rtt'" class="output-panel">
            <RttTerminal :session-id="sessionId" />
          </div>
        </div>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useSessionsStore } from '../stores/sessions';
import ProbeSelector from './ProbeSelector.vue';
import FlashPanel from './FlashPanel.vue';
import RttTerminal from './RttTerminal.vue';
import { useSessionIpc } from '../composables/useSessionIpc';

const props = defineProps<{ sessionId: string }>();
const store = useSessionsStore();

useSessionIpc(props.sessionId);

const session = computed(() =>
  store.sessions.find((s) => s.id === props.sessionId),
);

const outputTab = ref<'flashlog' | 'rtt'>('flashlog');
const flashLogRef = ref<HTMLDivElement | null>(null);
const flashLogBottomRef = ref<HTMLDivElement | null>(null);

// Auto-switch tabs based on session status
watch(
  () => session.value?.status,
  (status) => {
    if (status === 'flashing') outputTab.value = 'flashlog';
    else if (status === 'rtt-active') outputTab.value = 'rtt';
  },
);

// Auto-scroll flash log when new lines arrive
watch(
  () => session.value?.flashLog.length,
  async () => {
    if (outputTab.value !== 'flashlog') return;
    await nextTick();
    flashLogBottomRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  },
);

function clearOutput() {
  if (outputTab.value === 'flashlog') store.clearFlashLog(props.sessionId);
  else store.clearRtt(props.sessionId);
}

const statusColor = computed(() => {
  switch (session.value?.status) {
    case 'rtt-active': return 'positive';
    case 'error':      return 'negative';
    case 'flashing':   return 'warning';
    default:           return 'grey';
  }
});

const statusLabel = computed(() => {
  switch (session.value?.status) {
    case 'rtt-active': return 'RTT Active';
    case 'error':      return 'Error';
    case 'flashing':   return 'Flashing…';
    case 'detecting':  return 'Detecting…';
    default:           return 'Idle';
  }
});
</script>
