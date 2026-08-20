<script setup lang="ts">
import type { ColumnType } from 'nocodb-sdk'

const props = defineProps<{
  modelValue: boolean
  fields: ColumnType[]
  recordCount: number
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'apply': [payload: { field: ColumnType; value: any }]
}>()

const dialogShow = useVModel(props, 'modelValue', emit)
const selectedFieldId = ref<string>()
const hasValue = ref(false)
const draftRow = ref<Row>({ row: {}, oldRow: {}, rowMeta: {} })

const selectedField = computed(() => props.fields.find((field) => field.id === selectedFieldId.value))

const fieldValue = computed({
  get: () => (selectedField.value?.title ? draftRow.value.row[selectedField.value.title] : undefined),
  set: (value) => {
    if (!selectedField.value?.title) return

    draftRow.value.row[selectedField.value.title] = value
    hasValue.value = true
  },
})

const resetValue = () => {
  draftRow.value = { row: {}, oldRow: {}, rowMeta: {} }
  hasValue.value = false
}

watch(selectedFieldId, resetValue)
watch(dialogShow, (visible) => {
  if (visible) {
    selectedFieldId.value = undefined
    resetValue()
  }
})

const clearValue = () => {
  fieldValue.value = null
}

const apply = () => {
  if (!selectedField.value || !hasValue.value || props.loading) return

  emit('apply', { field: selectedField.value, value: fieldValue.value })
}
</script>

<template>
  <NcModal
    v-if="dialogShow"
    v-model:visible="dialogShow"
    :show-separator="false"
    :header="$t('general.bulkUpdate')"
    size="small"
    @keydown.esc="dialogShow = false"
  >
    <div class="mb-4 text-sm text-nc-content-gray">{{ recordCount }} {{ $t('general.selected') }}</div>

    <div class="flex flex-col gap-2">
      <label class="text-xs font-medium text-nc-content-gray-emphasis" for="nc-list-bulk-update-field">
        {{ $t('objects.field') }}
      </label>
      <a-select
        id="nc-list-bulk-update-field"
        v-model:value="selectedFieldId"
        data-testid="nc-list-bulk-update-field"
        class="w-full"
        :placeholder="$t('placeholder.selectField')"
      >
        <a-select-option v-for="field in fields" :key="field.id" :value="field.id">
          {{ field.title }}
        </a-select-option>
      </a-select>
    </div>

    <div v-if="selectedField" class="mt-4 flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-nc-content-gray-emphasis">{{ selectedField.title }}</span>
        <NcButton
          data-testid="nc-list-bulk-update-clear"
          type="text"
          size="small"
          :disabled="!!isColumnRequired(selectedField)"
          @click="clearValue"
        >
          {{ $t('general.clear') }}
        </NcButton>
      </div>

      <LazySmartsheetRow :row="draftRow">
        <div
          data-testid="nc-list-bulk-update-value"
          class="min-h-10 w-full rounded-lg border-1 border-nc-border-gray-medium bg-nc-bg-default px-3 py-2"
        >
          <LazySmartsheetCell v-model="fieldValue" :column="selectedField" :edit-enabled="true" :active="true" class="min-h-6" />
        </div>
      </LazySmartsheetRow>
    </div>

    <div class="mt-5 flex justify-end gap-2">
      <NcButton data-testid="nc-list-bulk-update-cancel" type="secondary" size="small" @click="dialogShow = false">
        {{ $t('general.cancel') }}
      </NcButton>
      <NcButton
        data-testid="nc-list-bulk-update-apply"
        type="primary"
        size="small"
        :disabled="!selectedField || !hasValue"
        :loading="loading"
        @click="apply"
      >
        {{ $t('general.apply') }}
      </NcButton>
    </div>
  </NcModal>
</template>
