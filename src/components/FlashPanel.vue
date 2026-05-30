<template>
  <div>
    <!-- Firmware file picker -->
    <q-input
      v-model="firmwarePath"
      label="Firmware File"
      dense
      outlined
      class="q-mb-sm"
      :hint="firmwareHint"
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
      <!-- Target / board config — required, filterable dropdown -->
      <div class="row items-center q-gutter-sm q-mb-sm">
        <q-select
          v-model="openocdTarget"
          :options="filteredTargetCfgs"
          use-input
          input-debounce="0"
          label="OpenOCD Target Config"
          dense
          outlined
          class="col"
          :loading="loadingCfgs"
          clearable
          hint="e.g. board/nrf52840dk_nrf52840.cfg"
          @filter="filterTargetCfgs"
          @click="() => { openocdTarget = ''; filteredTargetCfgs = allTargetCfgs; }"
          @update:model-value="(v) => store.updateConfig(sessionId, { openocdTarget: (v as string) ?? '' })"
        />
        <q-btn flat dense round icon="folder_open" title="Browse .cfg file" @click="browseOpenocdCfg('target')" />
      </div>

      <!-- Interface config — optional override (auto-detected from probe type when off) -->
      <q-toggle
        v-model="openocdInterfaceOverride"
        label="Override OpenOCD Interface Config"
        dense
        class="q-mb-xs"
        @update:model-value="onOpenOcdInterfaceOverrideChange"
      />
      <div v-if="openocdInterfaceOverride" class="row items-center q-gutter-sm q-mb-sm q-ml-sm">
        <q-select
          v-model="openocdInterface"
          :options="filteredInterfaceCfgs"
          use-input
          input-debounce="0"
          label="OpenOCD Interface Config"
          dense
          outlined
          class="col"
          :loading="loadingCfgs"
          clearable
          hint="e.g. interface/stlink.cfg"
          @filter="filterInterfaceCfgs"
          @update:model-value="(v) => store.updateConfig(sessionId, { openocdInterface: (v as string) ?? '' })"
        />
        <q-btn flat dense round icon="folder_open" title="Browse .cfg file" @click="browseOpenocdCfg('interface')" />
      </div>

      <!-- RTT scan config -->
      <div class="text-caption text-grey-6 q-mb-xs">RTT Scan Region</div>
      <div class="row q-gutter-xs q-mb-xs">
        <q-btn
          v-for="preset in rttPresets"
          :key="preset.label"
          dense
          unelevated
          size="sm"
          color="blue-grey-7"
          :label="preset.label"
          @click="applyRttPreset(preset)"
        />
      </div>
      <div class="row q-gutter-sm q-mb-sm">
        <q-input
          v-model="rttScanAddress"
          label="Scan Start Address"
          dense
          outlined
          class="col"
          hint="e.g. 0x20000000"
          @update:model-value="(v) => store.updateConfig(sessionId, { rttScanAddress: v as string })"
        />
        <q-input
          v-model="rttScanSize"
          label="Scan Size"
          dense
          outlined
          class="col"
          hint="e.g. 0x40000"
          @update:model-value="(v) => store.updateConfig(sessionId, { rttScanSize: v as string })"
        />
      </div>
    </template>

    <!-- BMP options -->
    <template v-if="session?.probe?.type === 'bmp'">
      <q-toggle
        v-model="gdbOverride"
        label="Override GDB executable"
        dense
        class="q-mb-xs"
        @update:model-value="onGdbOverrideChange"
      />
      <template v-if="gdbOverride">
        <div class="row q-gutter-sm q-mb-sm q-ml-sm">
          <q-radio
            v-model="gdbSource"
            val="system"
            label="Use arm-none-eabi-gdb from system PATH"
            dense
            @update:model-value="onGdbSourceChange"
          />
          <q-radio
            v-model="gdbSource"
            val="custom"
            label="Custom path"
            dense
            @update:model-value="onGdbSourceChange"
          />
        </div>
        <q-input
          v-if="gdbSource === 'custom'"
          v-model="gdbPath"
          label="GDB Executable Path"
          dense
          outlined
          class="q-mb-sm"
          hint="Full path to arm-none-eabi-gdb executable"
          @update:model-value="(v) => store.updateConfig(sessionId, { gdbPath: v as string })"
        >
          <template #append>
            <q-btn flat dense round icon="folder_open" title="Browse" @click="browseGdb" />
          </template>
        </q-input>
      </template>
      <q-toggle
        v-model="powerOverBMP"
        label="Power target via BMP (tpwr)"
        dense
        class="q-mb-sm"
        @update:model-value="(v) => store.updateConfig(sessionId, { powerOverBMP: v as boolean })"
      />
      <q-toggle
        v-model="bmpUartOverride"
        label="Override RTT UART port"
        dense
        class="q-mb-xs"
        @update:model-value="onBmpUartOverrideChange"
      />
      <div v-if="bmpUartOverride" class="row items-center q-gutter-sm q-mb-sm q-ml-sm">
        <q-select
          v-model="bmpUartPort"
          :options="availablePorts"
          :loading="loadingPorts"
          label="RTT UART Port"
          dense
          outlined
          class="col"
          clearable
          hint="e.g. COM6"
          @update:model-value="(v) => store.updateConfig(sessionId, { bmpUartPort: (v as string) ?? '' })"
        />
        <q-btn
          flat dense round icon="refresh"
          title="Refresh ports"
          :loading="loadingPorts"
          @click="loadAvailablePorts"
        />
      </div>
    </template>

    <!-- Flash base address (shown for .bin files) -->
    <q-input
      v-if="isBinFile"
      v-model="flashAddress"
      label="Flash Base Address"
      dense
      outlined
      class="q-mb-sm"
      hint="Load address for .bin file (e.g. 0x08000000)"
      @update:model-value="(v) => store.updateConfig(sessionId, { flashAddress: v as string })"
    />

    <!-- Action buttons -->
    <div v-if="!isActive" class="row q-gutter-sm q-mt-sm">
      <q-btn
        color="primary"
        icon="flash_on"
        label="Flash"
        :disable="!canFlash"
        @click="doFlash"
      />
      <q-btn
        color="secondary"
        icon="bolt"
        label="Flash + RTT"
        :disable="!canFlash"
        @click="doFlashAndRtt"
      />
      <q-btn
        color="positive"
        icon="terminal"
        label="RTT Only"
        :disable="!canRttOnly"
        @click="doRttOnly"
      />
    </div>
    <div v-else class="row q-gutter-sm q-mt-sm">
      <q-btn
        color="negative"
        icon="stop"
        label="Stop"
        @click="doStop"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRaw, watch } from 'vue';
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
  session.value?.config.openocdTarget ?? '',
);
const openocdInterface = ref(
  session.value?.config.openocdInterface?.trim() || 'interface/stlink.cfg',
);
const openocdInterfaceOverride = ref(session.value?.config.openocdInterfaceOverride ?? false);
const allTargetCfgs = ref<string[]>([]);
const filteredTargetCfgs = ref<string[]>([]);
const allInterfaceCfgs = ref<string[]>([]);
const filteredInterfaceCfgs = ref<string[]>([]);
const loadingCfgs = ref(false);
const gdbPath = ref(session.value?.config.gdbPath ?? '');
const gdbOverride = ref(session.value?.config.gdbOverride ?? false);
const gdbSource = ref<'system' | 'custom'>(
  session.value?.config.gdbPath ? 'custom' : 'system',
);
const powerOverBMP = ref(session.value?.config.powerOverBMP ?? false);
const flashAddress = ref(session.value?.config.flashAddress ?? '0x08000000');
const bmpUartPort = ref(session.value?.config.bmpUartPort ?? '');
const bmpUartOverride = ref(!!(session.value?.config.bmpUartPort?.trim()));
const availablePorts = ref<string[]>([]);
const loadingPorts = ref(false);
const rttScanAddress = ref(session.value?.config.rttScanAddress ?? '0x20000000');
const rttScanSize = ref(session.value?.config.rttScanSize ?? '0x40000');

const rttPresets = [
  { label: 'nRF52',  address: '0x20000000', size: '0x10000' },
  { label: 'nRF52840', address: '0x20000000', size: '0x40000' },
  { label: 'STM32',  address: '0x20000000', size: '0x20000' },
  { label: 'RP2040', address: '0x20000000', size: '0x42000' },
] as const;

function applyRttPreset(preset: { address: string; size: string }) {
  rttScanAddress.value = preset.address;
  rttScanSize.value = preset.size;
  store.updateConfig(props.sessionId, { rttScanAddress: preset.address, rttScanSize: preset.size });
}

const isBmpProbe = computed(() => session.value?.probe?.type === 'bmp');

const isActive = computed(() => {
  const s = session.value?.status;
  return s === 'flashing' || s === 'rtt-active';
});

const firmwareHint = computed(() =>
  isBmpProbe.value ? 'Path to .elf file (BMP supports ELF only)' : 'Path to .elf / .hex / .bin file',
);

const isBinFile = computed(() =>
  !isBmpProbe.value && !showOpenOcdOptions.value && firmwarePath.value.toLowerCase().endsWith('.bin'),
);

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
    s.status === 'idle'
  );
});

const canRttOnly = computed(() => {
  const s = session.value;
  return !!s?.probe && s.status === 'idle';
});

function onFirmwareChange(v: string | number | null) {
  store.updateConfig(props.sessionId, { firmwarePath: String(v ?? '') });
}

function onGdbOverrideChange(v: boolean) {
  store.updateConfig(props.sessionId, { gdbOverride: v });
  if (!v) {
    gdbPath.value = '';
    gdbSource.value = 'system';
    store.updateConfig(props.sessionId, { gdbPath: '' });
  }
}

function onBmpUartOverrideChange(v: boolean) {
  if (!v) {
    bmpUartPort.value = '';
    store.updateConfig(props.sessionId, { bmpUartPort: '' });
  } else {
    void loadAvailablePorts();
  }
}

async function loadAvailablePorts() {
  if (!window.flashToolApi) return;
  loadingPorts.value = true;
  try {
    availablePorts.value = await window.flashToolApi.listPorts();
  } finally {
    loadingPorts.value = false;
  }
}

async function loadOpenOcdCfgs() {
  if (!window.flashToolApi) return;
  loadingCfgs.value = true;
  try {
    const [targetCfgs, interfaceCfgs] = await Promise.all([
      window.flashToolApi.listOpenOcdCfgs(['target', 'board']),
      window.flashToolApi.listOpenOcdCfgs(['interface']),
    ]);
    allTargetCfgs.value = targetCfgs;
    filteredTargetCfgs.value = targetCfgs;
    allInterfaceCfgs.value = interfaceCfgs;
    filteredInterfaceCfgs.value = interfaceCfgs;
  } finally {
    loadingCfgs.value = false;
  }
}

function filterTargetCfgs(val: string, update: (fn: () => void) => void) {
  update(() => {
    const needle = val.toLowerCase();
    filteredTargetCfgs.value = needle
      ? allTargetCfgs.value.filter((c) => c.toLowerCase().includes(needle))
      : allTargetCfgs.value;
  });
}

function filterInterfaceCfgs(val: string, update: (fn: () => void) => void) {
  update(() => {
    const needle = val.toLowerCase();
    filteredInterfaceCfgs.value = needle
      ? allInterfaceCfgs.value.filter((c) => c.toLowerCase().includes(needle))
      : allInterfaceCfgs.value;
  });
}

function onOpenOcdInterfaceOverrideChange(v: boolean) {
  if (!v) {
    openocdInterface.value = 'interface/stlink.cfg';
    store.updateConfig(props.sessionId, { openocdInterface: '' });
  } else {
    store.updateConfig(props.sessionId, { openocdInterface: openocdInterface.value, openocdInterfaceOverride: true });
    if (!allInterfaceCfgs.value.length) void loadOpenOcdCfgs();
  }
}

async function browseOpenocdCfg(type: 'target' | 'interface') {
  if (!window.flashToolApi) return;
  const filePath = await window.flashToolApi.openFileDialog([
    { name: 'OpenOCD Config', extensions: ['cfg'] },
    { name: 'All Files', extensions: ['*'] },
  ]);
  if (!filePath) return;
  if (type === 'target') {
    openocdTarget.value = filePath;
    store.updateConfig(props.sessionId, { openocdTarget: filePath });
  } else {
    openocdInterface.value = filePath;
    store.updateConfig(props.sessionId, { openocdInterface: filePath });
  }
}

function onGdbSourceChange(val: 'system' | 'custom') {
  if (val === 'system') {
    store.updateConfig(props.sessionId, { gdbPath: '' });
  }
}

async function browseFirmware() {
  if (!window.flashToolApi) return;
  const filters = isBmpProbe.value
    ? [{ name: 'ELF Firmware', extensions: ['elf'] }, { name: 'All Files', extensions: ['*'] }]
    : [{ name: 'Firmware', extensions: ['elf', 'hex', 'bin'] }, { name: 'All Files', extensions: ['*'] }];
  const filePath = await window.flashToolApi.openFileDialog(filters);
  if (filePath) {
    firmwarePath.value = filePath;
    store.updateConfig(props.sessionId, { firmwarePath: filePath });
  }
}

async function browseGdb() {
  if (!window.flashToolApi) return;
  const filePath = await window.flashToolApi.openFileDialog([
    { name: 'Executable', extensions: ['exe', '*'] },
    { name: 'All Files', extensions: ['*'] },
  ]);
  if (filePath) {
    gdbPath.value = filePath;
    gdbSource.value = 'custom';
    store.updateConfig(props.sessionId, { gdbPath: filePath });
  }
}

async function doFlash() {
  if (!window.flashToolApi || !session.value?.probe) return;
  store.setStatus(props.sessionId, 'flashing');
  const probe = JSON.parse(JSON.stringify(toRaw(session.value.probe)));
  const config = JSON.parse(JSON.stringify(toRaw(session.value.config)));
  try {
    await window.flashToolApi.flash(props.sessionId, probe, config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    $q.notify({ type: 'negative', message: `Flash failed: ${msg}` });
    store.setStatus(props.sessionId, 'error', msg);
  }
}

async function doFlashAndRtt() {
  if (!window.flashToolApi || !session.value?.probe) return;
  store.setStatus(props.sessionId, 'flashing');
  const probe = JSON.parse(JSON.stringify(toRaw(session.value.probe)));
  const config = JSON.parse(JSON.stringify(toRaw(session.value.config)));
  try {
    await window.flashToolApi.flashAndRtt(props.sessionId, probe, config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    $q.notify({ type: 'negative', message: `Flash+RTT failed: ${msg}` });
    store.setStatus(props.sessionId, 'error', msg);
  }
}

async function doRttOnly() {
  if (!window.flashToolApi || !session.value?.probe) return;
  const probe = JSON.parse(JSON.stringify(toRaw(session.value.probe)));
  const config = JSON.parse(JSON.stringify(toRaw(session.value.config)));
  try {
    await window.flashToolApi.startRtt(props.sessionId, probe, config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    $q.notify({ type: 'negative', message: `RTT start failed: ${msg}` });
  }
}

async function doStop() {
  if (!window.flashToolApi) return;
  const s = session.value?.status;
  if (s === 'flashing') {
    await window.flashToolApi.cancelFlash(props.sessionId);
  } else if (s === 'rtt-active') {
    await window.flashToolApi.stopRtt(props.sessionId);
  }
}

watch(showOpenOcdOptions, (val) => {
  if (val) void loadOpenOcdCfgs();
}, { immediate: true });
</script>
