<template>
  <div>
    <!-- Detected probes list -->
    <q-select
      v-model="selectedProbe"
      :options="probeOptions"
      option-label="label"
      option-value="value"
      label="Detected Probe"
      dense
      outlined
      emit-value
      map-options
      clearable
      class="q-mb-sm"
      @update:model-value="onProbeSelect"
    >
      <template #prepend>
        <q-icon name="usb" />
      </template>
      <template #after>
        <q-btn
          round
          dense
          flat
          icon="refresh"
          title="Refresh probes"
          :loading="detecting"
          @click="detectProbes"
        />
      </template>
    </q-select>

    <!-- Probe type badge -->
    <div v-if="session?.probe" class="row q-gutter-xs q-mb-sm">
      <q-badge
        :color="probeTypeColor(session.probe.type)"
        :label="session.probe.type.toUpperCase()"
      />
      <q-badge
        v-if="session.probe.serialNumber"
        color="grey-7"
        :label="'SN: ' + session.probe.serialNumber"
      />
    </div>

    <!-- If STLink: tool selector -->
    <div v-if="session?.probe?.type === 'stlink'" class="q-mb-sm">
      <q-option-group
        v-model="flashTool"
        :options="[
          { label: 'st-flash (faster)', value: 'stlink' },
          { label: 'OpenOCD (RTT support)', value: 'openocd' },
        ]"
        color="primary"
        inline
        dense
        @update:model-value="onFlashToolChange"
      />
    </div>

    <!-- Status -->
    <div v-if="!session?.probe" class="text-caption text-grey-5">
      No probe selected. Click refresh to detect connected probes.
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useSessionsStore } from '../stores/sessions';
import type { ProbeInfo, ProbeType } from '../types';

const props = defineProps<{ sessionId: string }>();
const store = useSessionsStore();
const $q = useQuasar();

const detecting = ref(false);
const detectedProbes = ref<ProbeInfo[]>([]);

const session = computed(() =>
  store.sessions.find((s) => s.id === props.sessionId),
);

const selectedProbe = ref<string | null>(session.value?.probe?.path ?? null);
const flashTool = ref(session.value?.config.flashTool ?? 'stlink');

const probeOptions = computed(() =>
  detectedProbes.value.map((p) => ({
    label: p.name,
    value: p.path,
    probe: p,
  })),
);

function probeTypeColor(type: ProbeType): string {
  return type === 'bmp' ? 'deep-purple' : type === 'stlink' ? 'blue' : 'teal';
}

async function detectProbes() {
  if (!window.flashToolApi) {
    $q.notify({ type: 'negative', message: 'Flash Tool API not available (not running in Electron)' });
    return;
  }
  detecting.value = true;
  try {
    detectedProbes.value = await window.flashToolApi.detectProbes();
    if (detectedProbes.value.length === 0) {
      $q.notify({ type: 'info', message: 'No probes detected' });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    $q.notify({ type: 'negative', message: `Detection failed: ${msg}` });
  } finally {
    detecting.value = false;
  }
}

function onProbeSelect(path: string | null) {
  const probe = detectedProbes.value.find((p) => p.path === path) ?? null;
  store.updateProbe(props.sessionId, probe);
  if (probe?.type === 'stlink') {
    // Always default STLink to OpenOCD; sync the local ref so the toggle shows correctly
    flashTool.value = 'openocd';
    store.updateConfig(props.sessionId, { flashTool: 'openocd' });
  }
}

function onFlashToolChange(tool: string) {
  store.updateConfig(props.sessionId, {
    flashTool: tool as 'stlink' | 'openocd',
  });
}

onMounted(() => {
  detectProbes();
});
</script>
