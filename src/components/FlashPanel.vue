<template>
  <div>
    <!-- Firmware file picker -->
    <q-input
      v-model="firmwarePath"
      label="Firmware File"
      dense
      outlined
      class="q-mb-sm"
      hint="Path to .elf / .hex / .bin file"
      @update:model-value="onFirmwareChange"
    >
      <template #append>
        <q-btn
          flat
          dense
          round
          icon="folder_open"
          title="Browse"
          @click="browseFirmware"
        />
      </template>
    </q-input>

    <!-- OpenOCD target config (shown for openocd tool) -->
    <template v-if="showOpenOcdOptions">
      <q-input
        v-model="openocdTarget"
        label="OpenOCD Target Config"
        dense
        outlined
        class="q-mb-sm"
        hint="e.g. board/nrf52840dk_nrf52840.cfg"
        @update:model-value="(v) => store.updateConfig(sessionId, { openocdTarget: v as string })"
      />
      <q-input
        v-model="openocdInterface"
        label="OpenOCD Interface Config"
        dense
        outlined
        class="q-mb-sm"
        hint="e.g. interface/stlink.cfg"
        @update:model-value="(v) => store.updateConfig(sessionId, { openocdInterface: v as string })"
      />
    </template>

    <!-- BMP options -->
    <template v-if="session?.probe?.type === 'bmp'">
      <q-input
        v-model="gdbPath"
        label="GDB Executable"
        dense
        outlined
        class="q-mb-sm"
        hint="e.g. arm-none-eabi-gdb"
        @update:model-value="(v) => store.updateConfig(sessionId, { gdbPath: v as string })"
      />
      <q-toggle
        v-model="powerOverBMP"
        label="Power target via BMP (tpwr)"
        dense
        class="q-mb-sm"
        @update:model-value="(v) => store.updateConfig(sessionId, { powerOverBMP: v as boolean })"
      />
    </template>

    <!-- Flash button -->
    <div class="row q-gutter-sm q-mt-sm">
      <q-btn
        color="primary"
        icon="flash_on"
        label="Flash"
        :loading="session?.status === 'flashing'"
        :disable="!canFlash"
        @click="flash"
      />
      <q-btn
        v-if="session?.status === 'flashing'"
        flat
        color="negative"
        icon="stop"
        label="Cancel"
        @click="cancelFlash"
      />
    </div>

    <!-- Flash log -->
    <div v-if="session?.flashLog.length" class="flash-log q-mt-sm" style="max-height: 180px;">
      <div v-for="(line, i) in session.flashLog" :key="i">{{ line }}</div>
    </div>

    <!-- Error message -->
    <q-banner
      v-if="session?.status === 'error'"
      inline-actions
      class="text-white bg-negative q-mt-sm"
      dense
    >
      {{ session.errorMessage }}
    </q-banner>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import { useSessionsStore } from '../stores/sessions';

const props = defineProps<{ sessionId: string }>();
const store = useSessionsStore();
const $q = useQuasar();

const session = computed(() =>
  store.sessions.find((s) => s.id === props.sessionId),
);

const firmwarePath = ref(session.value?.config.firmwarePath ?? '');
const openocdTarget = ref(
  session.value?.config.openocdTarget ?? 'board/nrf52840dk_nrf52840.cfg',
);
const openocdInterface = ref(
  session.value?.config.openocdInterface ?? 'interface/stlink.cfg',
);
const gdbPath = ref(session.value?.config.gdbPath ?? 'arm-none-eabi-gdb');
const powerOverBMP = ref(session.value?.config.powerOverBMP ?? false);

const showOpenOcdOptions = computed(() => {
  const s = session.value;
  if (!s) return false;
  return (
    s.probe?.type === 'openocd' ||
    (s.probe?.type === 'stlink' && s.config.flashTool === 'openocd')
  );
});

const canFlash = computed(() => {
  const s = session.value;
  return (
    !!s?.probe &&
    !!s.config.firmwarePath &&
    s.status !== 'flashing' &&
    s.status !== 'detecting'
  );
});

function onFirmwareChange(v: string | number | null) {
  store.updateConfig(props.sessionId, { firmwarePath: String(v ?? '') });
}

async function browseFirmware() {
  if (!window.flashToolApi) return;
  const filePath = await window.flashToolApi.openFileDialog([
    { name: 'Firmware', extensions: ['elf', 'hex', 'bin'] },
    { name: 'All Files', extensions: ['*'] },
  ]);
  if (filePath) {
    firmwarePath.value = filePath;
    store.updateConfig(props.sessionId, { firmwarePath: filePath });
  }
}

async function flash() {
  if (!window.flashToolApi || !session.value?.probe) return;
  store.setStatus(props.sessionId, 'flashing');
  try {
    await window.flashToolApi.flash(props.sessionId, session.value.probe, session.value.config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    $q.notify({ type: 'negative', message: `Flash failed: ${msg}` });
    store.setStatus(props.sessionId, 'error', msg);
  }
}

async function cancelFlash() {
  if (!window.flashToolApi) return;
  await window.flashToolApi.cancelFlash(props.sessionId);
}
</script>
