<template>
  <q-page class="q-pa-none">
    <div v-if="store.sessions.length === 0" class="column items-center justify-center q-pa-xl">
      <q-icon name="cable" size="64px" color="grey-5" />
      <div class="text-h6 text-grey-6 q-mt-md">No sessions yet</div>
      <div class="text-body2 text-grey-5 q-mt-sm">
        Click the <q-icon name="add" /> button to create a new flash/RTT session
      </div>
      <q-btn
        color="primary"
        icon="add"
        label="New Session"
        class="q-mt-lg"
        @click="store.createSession()"
      />
    </div>

    <div v-else class="column full-height">
      <!-- Session Tabs -->
      <q-tabs
        v-model="store.activeSessionId"
        align="left"
        dense
        class="bg-grey-9 text-white"
      >
        <q-tab
          v-for="session in store.sessions"
          :key="session.id"
          :name="session.id"
          :label="session.name"
        >
          <q-badge
            v-if="session.status === 'rtt-active'"
            color="positive"
            floating
            rounded
          />
          <q-badge
            v-else-if="session.status === 'error'"
            color="negative"
            floating
            rounded
          />
          <q-btn
            flat
            round
            dense
            size="xs"
            icon="close"
            class="q-ml-xs"
            @click.stop="confirmDelete(session.id)"
          />
        </q-tab>
        <q-btn
          flat
          round
          dense
          icon="add"
          size="sm"
          class="q-ml-sm self-center"
          @click="store.createSession()"
        />
      </q-tabs>

      <q-tab-panels
        v-model="store.activeSessionId"
        animated
        class="col"
      >
        <q-tab-panel
          v-for="session in store.sessions"
          :key="session.id"
          :name="session.id"
          class="q-pa-none"
        >
          <SessionPanel :session-id="session.id" />
        </q-tab-panel>
      </q-tab-panels>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useSessionsStore } from '../stores/sessions';
import { useQuasar } from 'quasar';
import SessionPanel from '../components/SessionPanel.vue';

const store = useSessionsStore();
const $q = useQuasar();

function confirmDelete(sessionId: string) {
  $q.dialog({
    title: 'Close Session',
    message: 'Are you sure you want to close this session?',
    cancel: true,
    persistent: true,
  }).onOk(() => {
    store.deleteSession(sessionId);
  });
}

// Create initial session on mount if none exist
if (store.sessions.length === 0) {
  store.createSession('Session 1');
}
</script>
