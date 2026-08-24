<script setup lang="ts">
import dayjs from 'dayjs'
import type { SnapshotType } from 'nocodb-sdk'

const { $api, $poller } = useNuxtApp()
const baseStore = useBase()
const basesStore = useBases()
const { base } = storeToRefs(baseStore)
const baseId = computed(() => base.value?.id as string | undefined)

const snapshots = ref<SnapshotType[]>([])
const loading = ref(false)
const creating = ref(false)
const actionId = ref<string>()
const newTitle = ref('')

const loadSnapshots = async () => {
  if (!baseId.value) return
  loading.value = true
  try {
    const response = await $api.baseSnapshot.list(baseId.value, { limit: 100, offset: 0 })
    snapshots.value = response.list || []
  } catch (error) {
    message.error(`Unable to load snapshots: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    loading.value = false
  }
}

const watchJob = (jobId: string, success: string) => {
  $poller.subscribe({ id: jobId }, async (event: { status?: string; data?: { error?: { message?: string } } }) => {
    if (event.status === JobStatus.COMPLETED) {
      message.success(success)
      creating.value = false
      actionId.value = undefined
      await loadSnapshots()
      await basesStore.loadProjects('workspace')
    } else if (event.status === JobStatus.FAILED) {
      message.error(event.data?.error?.message || 'Snapshot operation failed')
      creating.value = false
      actionId.value = undefined
      await loadSnapshots()
    }
  })
}

const createSnapshot = async () => {
  if (!baseId.value || creating.value) return
  creating.value = true
  try {
    const result = await $api.baseSnapshot.create(baseId.value, {
      title: newTitle.value.trim() || `Snapshot ${dayjs().format('YYYY-MM-DD HH:mm')}`,
    })
    newTitle.value = ''
    await loadSnapshots()
    watchJob(String(result.id), 'Snapshot created')
  } catch (error) {
    creating.value = false
    message.error(`Unable to create snapshot: ${await extractSdkResponseErrorMsg(error)}`)
  }
}

const restoreSnapshot = async (snapshot: SnapshotType) => {
  if (!baseId.value || !snapshot.id || snapshot.status !== 'ready') return
  actionId.value = String(snapshot.id)
  try {
    const result = await $api.baseSnapshot.restore(baseId.value, snapshot.id, {
      title: `${base.value?.title || 'Base'} restored`,
    })
    await loadSnapshots()
    watchJob(String(result.id), 'Snapshot restored into a new base')
  } catch (error) {
    actionId.value = undefined
    message.error(`Unable to restore snapshot: ${await extractSdkResponseErrorMsg(error)}`)
  }
}

const deleteSnapshot = (snapshot: SnapshotType) => {
  if (!baseId.value || !snapshot.id || ['creating', 'restoring'].includes(snapshot.status || '')) return
  Modal.confirm({
    title: `Delete “${snapshot.title || 'Untitled snapshot'}” permanently?`,
    content: 'The protected snapshot data will be removed. This cannot be undone.',
    okText: 'Delete Snapshot',
    okType: 'danger',
    cancelText: 'Cancel',
    onOk: async () => {
      actionId.value = String(snapshot.id)
      try {
        await $api.baseSnapshot.delete(baseId.value!, snapshot.id!)
        message.success('Snapshot deleted')
        await loadSnapshots()
      } catch (error) {
        message.error(`Unable to delete snapshot: ${await extractSdkResponseErrorMsg(error)}`)
      } finally {
        actionId.value = undefined
      }
    },
  })
}

const statusLabel = (status?: string) => {
  if (status === 'creating') return 'Creating'
  if (status === 'restoring') return 'Restoring'
  if (status === 'failed') return 'Failed'
  return 'Ready'
}

onMounted(loadSnapshots)
</script>

<template>
  <div data-testid="nc-settings-subtab-snapshots" class="flex w-full flex-col">
    <div class="text-lg font-semibold text-nc-content-gray-emphasis">Base snapshots</div>
    <div class="mt-2 text-sm leading-5 text-nc-content-gray-subtle2">
      Capture the base schema and records at a point in time. Restoring always creates a new base and never overwrites this one.
    </div>

    <div class="mt-6 flex gap-2 rounded-lg border border-nc-border-gray-medium p-3">
      <a-input
        v-model:value="newTitle"
        data-testid="nc-snapshot-title"
        :maxlength="120"
        placeholder="Snapshot name (optional)"
        @press-enter="createSnapshot"
      />
      <NcButton data-testid="nc-snapshot-create" type="primary" :loading="creating" :disabled="creating" @click="createSnapshot">
        New snapshot
      </NcButton>
    </div>

    <div class="mt-4 overflow-hidden rounded-lg border border-nc-border-gray-medium">
      <div v-if="loading" class="p-6 text-center text-nc-content-gray-muted">Loading snapshots…</div>
      <div v-else-if="!snapshots.length" class="p-8 text-center text-nc-content-gray-muted">No snapshots yet.</div>
      <div
        v-for="snapshot in snapshots"
        v-else
        :key="String(snapshot.id)"
        :data-testid="`nc-snapshot-row-${snapshot.id}`"
        class="flex items-center gap-3 border-b border-nc-border-gray-medium px-4 py-3 last:border-b-0"
      >
        <GeneralIcon icon="camera" class="h-5 w-5 flex-none text-nc-content-gray-muted" />
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium text-nc-content-gray-emphasis">{{ snapshot.title }}</div>
          <div class="mt-0.5 flex items-center gap-2 text-xs text-nc-content-gray-muted">
            <span>{{ dayjs(snapshot.created_at).format('D MMM YYYY, HH:mm') }}</span>
            <span>•</span>
            <span :class="{ 'text-nc-content-red-medium': snapshot.status === 'failed' }">
              {{ statusLabel(snapshot.status) }}
            </span>
            <template v-if="snapshot.manifest?.tables">
              <span>•</span>
              <span>{{ snapshot.manifest.tables.length }} tables</span>
            </template>
          </div>
          <div v-if="snapshot.status === 'failed' && snapshot.error" class="mt-1 truncate text-xs text-nc-content-red-medium">
            {{ snapshot.error }}
          </div>
        </div>
        <NcButton
          size="small"
          type="secondary"
          :data-testid="`nc-snapshot-restore-${snapshot.id}`"
          :disabled="snapshot.status !== 'ready' || Boolean(actionId)"
          :loading="actionId === String(snapshot.id) && snapshot.status === 'restoring'"
          @click="restoreSnapshot(snapshot)"
        >
          Restore
        </NcButton>
        <NcButton
          size="small"
          type="danger"
          :data-testid="`nc-snapshot-delete-${snapshot.id}`"
          :disabled="['creating', 'restoring'].includes(snapshot.status || '') || Boolean(actionId)"
          :loading="actionId === String(snapshot.id)"
          @click="deleteSnapshot(snapshot)"
        >
          Delete
        </NcButton>
      </div>
    </div>
  </div>
</template>
