<script setup lang="ts">
import {
  RelationTypes,
  ViewTypes,
  isLinksOrLTAR,
  type LinkToAnotherRecordType,
  type ListType,
  type ListViewLevelType,
  type TableType,
} from 'nocodb-sdk'

const activeView = inject(ActiveViewInj, ref())
const meta = inject(MetaInj, ref())
const isPublic = inject(IsPublicInj, ref(false))
const isLocked = inject(IsLockedInj, ref(false))

const { getMeta } = useMetas()
const { updateViewMeta } = useViewsStore()

const visible = ref(false)
const saving = ref(false)
const loading = ref(false)
const draft = ref<ListViewLevelType[]>([])
const parentMetas = ref<TableType[]>([])
const targetMetas = ref<TableType[]>([])

const cloneLevels = () =>
  (JSON.parse(JSON.stringify((activeView.value?.view as ListType | undefined)?.levels ?? [])) as ListViewLevelType[]).map(
    (level) => ({
      ...level,
      sort: Array.isArray(level.sort) ? level.sort.join(',') : level.sort,
    }),
  )

const relationOptions = (index: number) =>
  (parentMetas.value[index]?.columns ?? []).filter(
    (column) =>
      isLinksOrLTAR(column) && (column.colOptions as LinkToAnotherRecordType | undefined)?.type === RelationTypes.HAS_MANY,
  )

const fieldOptions = (index: number) =>
  (targetMetas.value[index]?.columns ?? []).filter((column) => !column.system && column.id && column.title)

const hydrate = async () => {
  loading.value = true
  try {
    parentMetas.value = []
    targetMetas.value = []
    let parent = meta.value as TableType | undefined
    for (const level of draft.value) {
      if (!parent) break
      parentMetas.value.push(parent)
      const relation = parent.columns?.find((column) => column.id === level.fk_relation_column_id)
      const relatedId = (relation?.colOptions as LinkToAnotherRecordType | undefined)?.fk_related_model_id
      const target = relatedId ? await getMeta(relatedId) : null
      if (!target) break
      level.fk_related_model_id = target.id
      targetMetas.value.push(target)
      parent = target
    }
    if (!draft.value.length && meta.value) parentMetas.value = [meta.value as TableType]
  } finally {
    loading.value = false
  }
}

const open = async () => {
  draft.value = cloneLevels()
  visible.value = true
  await hydrate()
}

const addLevel = () => {
  if (draft.value.length >= 3) return
  const parent = draft.value.length ? targetMetas.value[draft.value.length - 1] : (meta.value as TableType | undefined)
  if (!parent) return
  parentMetas.value[draft.value.length] = parent
  draft.value.push({
    fk_relation_column_id: '',
    fields: [],
    page_size: 25,
    show_empty: false,
    recursive: false,
    max_depth: 1,
  })
}

const changeRelation = async (index: number, relationId: string) => {
  const parent = parentMetas.value[index]
  const relation = parent?.columns?.find((column) => column.id === relationId)
  const relatedId = (relation?.colOptions as LinkToAnotherRecordType | undefined)?.fk_related_model_id
  draft.value.splice(index + 1)
  parentMetas.value.splice(index + 1)
  targetMetas.value.splice(index)
  if (!relatedId) return

  const target = await getMeta(relatedId)
  if (!target) return
  targetMetas.value[index] = target
  draft.value[index].fk_related_model_id = target.id
  const primary = target.columns?.find((column) => column.pv)
  draft.value[index].fields = primary?.id ? [primary.id] : []
  const selfReference = target.id === parent.id
  draft.value[index].recursive = selfReference && Boolean(draft.value[index].recursive)
  draft.value[index].max_depth = 1
}

const removeLevel = (index: number) => {
  draft.value.splice(index)
  parentMetas.value.splice(index)
  targetMetas.value.splice(index)
  if (!draft.value.length && meta.value) parentMetas.value = [meta.value as TableType]
}

const isSelfReference = (index: number) => parentMetas.value[index]?.id === targetMetas.value[index]?.id

const effectiveDepth = computed(() =>
  draft.value.reduce((total, level) => total + (level.recursive ? Number(level.max_depth ?? 1) : 1), 0),
)

const canSave = computed(
  () =>
    !isLocked.value &&
    effectiveDepth.value <= 3 &&
    draft.value.every(
      (level, index) =>
        level.fk_relation_column_id && level.fk_related_model_id && (!level.recursive || index === draft.value.length - 1),
    ),
)

const save = async () => {
  if (!activeView.value?.id || !canSave.value) return
  saving.value = true
  try {
    const levels = draft.value.map((level) => ({
      fk_relation_column_id: level.fk_relation_column_id,
      fields: level.fields ?? [],
      where: level.where?.trim() || undefined,
      sort: typeof level.sort === 'string' ? level.sort.trim() || undefined : level.sort,
      show_empty: Boolean(level.show_empty),
      page_size: Number(level.page_size ?? 25),
      recursive: Boolean(level.recursive),
      max_depth: level.recursive ? Number(level.max_depth ?? 1) : 1,
    }))
    const updated = await updateViewMeta(activeView.value.id, ViewTypes.LIST, { levels })
    if (updated?.view && activeView.value) activeView.value.view = updated.view
    visible.value = false
  } catch (e: any) {
    message.error((await extractSdkResponseErrorMsg(e)) || 'Unable to save List hierarchy')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <NcButton
    v-if="!isPublic"
    class="nc-list-hierarchy-btn nc-toolbar-btn !h-7 !border-0"
    size="small"
    type="secondary"
    :show-as-disabled="isLocked"
    @click="open"
  >
    <div class="flex items-center gap-1.5">
      <GeneralIcon icon="settings" class="h-4 w-4" />
      <span class="text-[13px] font-medium">Hierarchy</span>
      <span v-if="(activeView?.view as ListType)?.levels?.length" class="rounded bg-nc-bg-gray-medium px-1 text-xs">
        {{ (activeView?.view as ListType).levels?.length }}
      </span>
    </div>
  </NcButton>

  <NcModal v-model:visible="visible" width="680px" :show-separator="false">
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <GeneralIcon icon="settings" class="h-5 w-5" />
        List hierarchy
      </div>
    </template>

    <div class="flex max-h-[65vh] flex-col gap-3 overflow-auto" :aria-busy="loading">
      <p class="text-small text-nc-content-gray-subtle">
        Add up to three lazy Has-Many levels. Related records are loaded only when a row is expanded.
      </p>

      <div v-for="(level, index) in draft" :key="index" class="rounded-lg border border-nc-border-gray-medium p-3">
        <div class="mb-3 flex items-center justify-between">
          <span class="font-medium">Level {{ index + 1 }}</span>
          <NcButton size="xsmall" type="text" @click="removeLevel(index)">Remove</NcButton>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <label class="flex flex-col gap-1 text-small">
            <span class="text-nc-content-gray-subtle">Has-Many field</span>
            <a-select
              v-model:value="level.fk_relation_column_id"
              class="w-full"
              placeholder="Select a relationship"
              @change="changeRelation(index, $event)"
            >
              <a-select-option v-for="column in relationOptions(index)" :key="column.id" :value="column.id">
                {{ column.title }}
              </a-select-option>
            </a-select>
          </label>

          <label class="flex flex-col gap-1 text-small">
            <span class="text-nc-content-gray-subtle">Displayed fields</span>
            <a-select v-model:value="level.fields" mode="multiple" class="w-full" placeholder="Choose fields">
              <a-select-option v-for="column in fieldOptions(index)" :key="column.id" :value="column.id">
                {{ column.title }}
              </a-select-option>
            </a-select>
          </label>

          <label class="flex flex-col gap-1 text-small">
            <span class="text-nc-content-gray-subtle">Where filter</span>
            <a-input v-model:value="level.where" placeholder="Optional existing filter expression" />
          </label>

          <label class="flex flex-col gap-1 text-small">
            <span class="text-nc-content-gray-subtle">Sort</span>
            <a-input v-model:value="level.sort" placeholder="Optional sort expression" />
          </label>

          <label class="flex flex-col gap-1 text-small">
            <span class="text-nc-content-gray-subtle">Page size</span>
            <a-input-number v-model:value="level.page_size" :min="1" :max="100" class="w-full" />
          </label>

          <div class="flex flex-col justify-end gap-2 pb-1 text-small">
            <NcSwitch v-model:checked="level.show_empty" size="small">Show empty child sections</NcSwitch>
            <NcSwitch v-if="isSelfReference(index)" v-model:checked="level.recursive" size="small">
              Repeat this self-reference
            </NcSwitch>
          </div>

          <label v-if="level.recursive" class="flex flex-col gap-1 text-small">
            <span class="text-nc-content-gray-subtle">Recursive depth</span>
            <a-input-number v-model:value="level.max_depth" :min="1" :max="3 - index" class="w-full" />
          </label>
        </div>
      </div>

      <NcButton
        v-if="draft.length < 3"
        type="dashed"
        :disabled="draft.length > 0 && (!targetMetas[draft.length - 1] || draft[draft.length - 1].recursive)"
        @click="addLevel"
      >
        Add hierarchy level
      </NcButton>

      <div v-if="effectiveDepth > 3" class="text-small text-nc-content-red">
        The effective hierarchy depth cannot exceed three.
      </div>
      <div v-if="!draft.length" class="rounded bg-nc-bg-gray-light p-3 text-small text-nc-content-gray-subtle">
        This List is flat. Add a level to enable linked expansion.
      </div>
    </div>

    <div class="mt-5 flex justify-end gap-2">
      <NcButton size="small" type="secondary" @click="visible = false">Cancel</NcButton>
      <NcButton size="small" type="primary" :disabled="!canSave" :loading="saving" @click="save">Save hierarchy</NcButton>
    </div>
  </NcModal>
</template>
