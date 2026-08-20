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
  'apply': [payload: { updates: Array<{ field: ColumnType; value: any }> }]
}>()

const dialogShow = useVModel(props, 'modelValue', emit)

interface BulkUpdateDraft {
  id: string
  fieldId?: string
  hasValue: boolean
  row: Row
}

const createDraft = (): BulkUpdateDraft => ({
  id: `bulk-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  hasValue: false,
  row: { row: {}, oldRow: {}, rowMeta: {} },
})

const drafts = ref<BulkUpdateDraft[]>([createDraft()])

const fieldFor = (draft: BulkUpdateDraft) => props.fields.find((field) => field.id === draft.fieldId)
const selectedFieldIds = computed(() => new Set(drafts.value.map((draft) => draft.fieldId).filter(Boolean)))
const availableFields = (draft: BulkUpdateDraft) =>
  props.fields.filter((field) => field.id === draft.fieldId || !selectedFieldIds.value.has(field.id))

const resetDraftValue = (draft: BulkUpdateDraft) => {
  draft.row = { row: {}, oldRow: {}, rowMeta: {} }
  draft.hasValue = false
}

const updateField = (draft: BulkUpdateDraft, fieldId: string) => {
  draft.fieldId = fieldId
  resetDraftValue(draft)
}

const fieldValue = (draft: BulkUpdateDraft) => {
  const field = fieldFor(draft)
  return field?.title ? draft.row.row[field.title] : undefined
}

const updateValue = (draft: BulkUpdateDraft, value: any) => {
  const field = fieldFor(draft)
  if (!field?.title) return

  draft.row.row[field.title] = value
  draft.hasValue = true
}

watch(dialogShow, (visible) => {
  if (visible) {
    drafts.value = [createDraft()]
  }
})

const clearValue = (draft: BulkUpdateDraft) => {
  updateValue(draft, null)
}

const addDraft = () => {
  if (drafts.value.length >= props.fields.length) return
  drafts.value.push(createDraft())
}

const removeDraft = (draftId: string) => {
  if (drafts.value.length === 1) return
  drafts.value = drafts.value.filter((draft) => draft.id !== draftId)
}

const validUpdates = computed(() =>
  drafts.value.flatMap((draft) => {
    const field = fieldFor(draft)
    return field && draft.hasValue ? [{ field, value: fieldValue(draft) }] : []
  }),
)

const canApply = computed(
  () =>
    drafts.value.length > 0 &&
    validUpdates.value.length === drafts.value.length &&
    new Set(validUpdates.value.map(({ field }) => field.id)).size === drafts.value.length,
)

const apply = () => {
  if (!canApply.value || props.loading) return

  emit('apply', { updates: validUpdates.value })
}
</script>

<template>
  <NcModal
    v-if="dialogShow"
    v-model:visible="dialogShow"
    :show-separator="false"
    :header="$t('general.bulkUpdate')"
    size="medium"
    @keydown.esc="dialogShow = false"
  >
    <div class="mb-4 text-sm text-nc-content-gray">{{ recordCount }} {{ $t('general.selected') }}</div>

    <div class="max-h-[55vh] flex flex-col gap-4 overflow-y-auto pr-1">
      <div
        v-for="(draft, index) in drafts"
        :key="draft.id"
        :data-testid="`nc-list-bulk-update-row-${index}`"
        class="rounded-lg border border-nc-border-gray-medium p-3"
      >
        <div class="mb-2 flex items-center gap-2">
          <label class="flex-1 text-xs font-medium text-nc-content-gray-emphasis" :for="`nc-list-bulk-update-field-${index}`">
            {{ $t('objects.field') }} {{ index + 1 }}
          </label>
          <NcButton
            v-if="drafts.length > 1"
            :data-testid="`nc-list-bulk-update-remove-${index}`"
            type="text"
            size="small"
            @click="removeDraft(draft.id)"
          >
            <GeneralIcon icon="delete" class="h-4 w-4" />
          </NcButton>
        </div>
        <a-select
          :id="`nc-list-bulk-update-field-${index}`"
          :value="draft.fieldId"
          :data-testid="index === 0 ? 'nc-list-bulk-update-field' : `nc-list-bulk-update-field-${index}`"
          class="w-full"
          :placeholder="$t('placeholder.selectField')"
          @change="(value) => updateField(draft, value)"
        >
          <a-select-option v-for="field in availableFields(draft)" :key="field.id" :value="field.id">
            {{ field.title }}
          </a-select-option>
        </a-select>

        <div v-if="fieldFor(draft)" class="mt-3 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-nc-content-gray-emphasis">{{ fieldFor(draft)?.title }}</span>
            <NcButton
              :data-testid="index === 0 ? 'nc-list-bulk-update-clear' : `nc-list-bulk-update-clear-${index}`"
              type="text"
              size="small"
              :disabled="!!isColumnRequired(fieldFor(draft)!)"
              @click="clearValue(draft)"
            >
              {{ $t('general.clear') }}
            </NcButton>
          </div>

          <LazySmartsheetRow :row="draft.row">
            <div
              :data-testid="index === 0 ? 'nc-list-bulk-update-value' : `nc-list-bulk-update-value-${index}`"
              class="min-h-10 w-full rounded-lg border-1 border-nc-border-gray-medium bg-nc-bg-default px-3 py-2"
            >
              <LazySmartsheetCell
                :model-value="fieldValue(draft)"
                :column="fieldFor(draft)"
                :edit-enabled="true"
                :active="true"
                class="min-h-6"
                @update:model-value="(value) => updateValue(draft, value)"
              />
            </div>
          </LazySmartsheetRow>
        </div>
      </div>
    </div>

    <NcButton
      data-testid="nc-list-bulk-update-add-field"
      class="mt-3"
      type="secondary"
      size="small"
      :disabled="drafts.length >= fields.length"
      @click="addDraft"
    >
      <div class="flex items-center gap-1">
        <GeneralIcon icon="plus" class="h-4 w-4" />
        {{ $t('labels.addAnotherField') }}
      </div>
    </NcButton>

    <div class="mt-5 flex justify-end gap-2">
      <NcButton data-testid="nc-list-bulk-update-cancel" type="secondary" size="small" @click="dialogShow = false">
        {{ $t('general.cancel') }}
      </NcButton>
      <NcButton
        data-testid="nc-list-bulk-update-apply"
        type="primary"
        size="small"
        :disabled="!canApply"
        :loading="loading"
        @click="apply"
      >
        {{ $t('general.apply') }}
      </NcButton>
    </div>
  </NcModal>
</template>
