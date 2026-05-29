<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-toolbar-title>
          <q-icon name="bolt" size="sm" class="q-mr-sm" />
          Flash Tool
        </q-toolbar-title>
        <q-btn
          flat
          round
          icon="add"
          title="New Session"
          @click="addSession"
        />
        <q-btn flat round icon="refresh" title="Detect Probes" @click="detectProbes" />
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { useSessionsStore } from '../stores/sessions';
import { useQuasar } from 'quasar';

const store = useSessionsStore();
const $q = useQuasar();

function addSession() {
  store.createSession();
}

async function detectProbes() {
  if (!window.flashToolApi) {
    $q.notify({ type: 'negative', message: 'Flash Tool API not available' });
    return;
  }
  $q.loading.show({ message: 'Detecting probes…' });
  try {
    await window.flashToolApi.detectProbes();
  } finally {
    $q.loading.hide();
  }
}
</script>
