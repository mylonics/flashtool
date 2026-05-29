<template>
  <div class="session-tab-panel">
    <div class="row q-pa-md q-col-gutter-md col">
      <!-- Left panel: probe + config -->
      <div class="col-12 col-md-4">
        <q-card flat bordered class="q-mb-md">
          <q-card-section class="q-pb-none">
            <div class="text-subtitle1">Probe</div>
          </q-card-section>
          <q-card-section>
            <ProbeSelector :session-id="sessionId" />
          </q-card-section>
        </q-card>

        <q-card flat bordered class="q-mb-md">
          <q-card-section class="q-pb-none">
            <div class="text-subtitle1">Flash Configuration</div>
          </q-card-section>
          <q-card-section>
            <FlashPanel :session-id="sessionId" />
          </q-card-section>
        </q-card>
      </div>

      <!-- Right panel: RTT terminal -->
      <div class="col-12 col-md-8">
        <q-card flat bordered style="height: 100%; min-height: 400px;">
          <q-card-section class="q-pb-none row items-center">
            <div class="text-subtitle1 col">RTT Output</div>
            <q-badge
              :color="rttStatusColor"
              :label="rttStatusLabel"
              class="q-mr-sm"
            />
            <q-btn
              v-if="session?.status !== 'rtt-active'"
              flat
              dense
              round
              icon="play_arrow"
              color="positive"
              title="Start RTT"
              :disable="!session?.probe || session?.status === 'flashing'"
              @click="startRtt"
            />
            <q-btn
              v-else
              flat
              dense
              round
              icon="stop"
              color="negative"
              title="Stop RTT"
              @click="stopRtt"
            />
            <q-btn
              flat
              dense
              round
              icon="delete_sweep"
              title="Clear"
              @click="store.clearRtt(sessionId)"
            />
          </q-card-section>
          <q-card-section class="q-pt-sm" style="height: calc(100% - 56px);">
            <RttTerminal :session-id="sessionId" />
          </q-card-section>
        </q-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import { useSessionsStore } from '../stores/sessions';
import ProbeSelector from './ProbeSelector.vue';
import FlashPanel from './FlashPanel.vue';
import RttTerminal from './RttTerminal.vue';
import { useSessionIpc } from '../composables/useSessionIpc';

const props = defineProps<{ sessionId: string }>();
const store = useSessionsStore();
const $q = useQuasar();

// Wire IPC events from Electron main process to Pinia store
useSessionIpc(props.sessionId);

const session = computed(() =>
  store.sessions.find((s) => s.id === props.sessionId),
);

const rttStatusColor = computed(() => {
  switch (session.value?.status) {
    case 'rtt-active':
      return 'positive';
    case 'error':
      return 'negative';
    case 'flashing':
      return 'warning';
    default:
      return 'grey';
  }
});

const rttStatusLabel = computed(() => {
  switch (session.value?.status) {
    case 'rtt-active':
      return 'RTT Active';
    case 'error':
      return 'Error';
    case 'flashing':
      return 'Flashing…';
    case 'detecting':
      return 'Detecting…';
    default:
      return 'Idle';
  }
});

async function startRtt() {
  if (!window.flashToolApi) {
    $q.notify({ type: 'negative', message: 'Flash Tool API not available' });
    return;
  }
  const s = session.value;
  if (!s?.probe) {
    $q.notify({ type: 'warning', message: 'No probe selected' });
    return;
  }
  try {
    await window.flashToolApi.startRtt(props.sessionId, s.probe, s.config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    $q.notify({ type: 'negative', message: `RTT start failed: ${msg}` });
  }
}

async function stopRtt() {
  if (!window.flashToolApi) return;
  await window.flashToolApi.stopRtt(props.sessionId);
}
</script>
