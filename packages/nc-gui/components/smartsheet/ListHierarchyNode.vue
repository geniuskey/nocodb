<script setup lang="ts">
import type { ColumnType, ListViewLevelType, TableType } from 'nocodb-sdk'

const props = defineProps<{
  record: Record<string, any>
  tableMeta: TableType
  levels: ListViewLevelType[]
  levelIndex: number
  depth: number
  path: string[]
}>()

const { $api } = useNuxtApp()
const { getMeta } = useMetas()

const expanded = ref(false)
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const children = ref<Record<string, any>[]>([])
const pageInfo = ref<Record<string, any>>({})

const level = computed(() => props.levels[props.levelIndex])
const relation = computed(() => props.tableMeta.columns?.find((column) => column.id === level.value?.fk_relation_column_id))
const relatedMeta = ref<TableType>()

const rowId = computed(() => extractPkFromRow(props.record, props.tableMeta.columns as ColumnType[]))

const displayFields = computed(() => {
  const columns = relatedMeta.value?.columns ?? []
  const configured = (level.value?.fields ?? [])
    .map((id) => columns.find((column) => column.id === id))
    .filter(Boolean) as ColumnType[]
  if (configured.length) return configured

  const primary = columns.find((column) => column.pv)
  return [primary, ...columns.filter((column) => !column.pk && column.id !== primary?.id)]
    .filter(Boolean)
    .slice(0, 3) as ColumnType[]
})

const totalRows = computed(() => Number(pageInfo.value.totalRows ?? pageInfo.value.count ?? children.value.length))
const hasMore = computed(() => pageInfo.value.isLastPage === false || children.value.length < totalRows.value)

const identity = (record: Record<string, any>) => {
  const id = extractPkFromRow(record, relatedMeta.value?.columns as ColumnType[])
  return `${relatedMeta.value?.id}:${id}`
}

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(', ')
  if (typeof value === 'object') {
    const objectValue = value as Record<string, any>
    return String(objectValue.title ?? objectValue.name ?? objectValue.value ?? JSON.stringify(objectValue))
  }
  return String(value)
}

const loadChildren = async (append = false) => {
  if (!level.value || !relation.value?.id || rowId.value === null || rowId.value === undefined || rowId.value === '') return
  loading.value = true
  error.value = ''
  try {
    relatedMeta.value = (await getMeta(level.value.fk_related_model_id!)) ?? undefined
    const result = await $api.dbDataTableRow.nestedList(
      props.tableMeta.id!,
      relation.value.id,
      encodeURIComponent(String(rowId.value)),
      {
        fields: displayFields.value.map((field) => field.title),
        sort: level.value.sort,
        where: level.value.where,
        offset: append ? children.value.length : 0,
        limit: level.value.page_size ?? 25,
      },
    )
    children.value = append
      ? [...children.value, ...(result.list as Record<string, any>[])]
      : (result.list as Record<string, any>[])
    pageInfo.value = result.pageInfo ?? {}
    loaded.value = true
  } catch (e: any) {
    error.value = (await extractSdkResponseErrorMsg(e)) || 'Unable to load linked records'
  } finally {
    loading.value = false
  }
}

const toggle = async () => {
  expanded.value = !expanded.value
  if (expanded.value && !loaded.value) await loadChildren()
}

const nextLevel = (record: Record<string, any>) => {
  const childIdentity = identity(record)
  const cycle = props.path.includes(childIdentity)
  if (cycle) return { cycle, enabled: false, levelIndex: props.levelIndex, depth: props.depth + 1 }

  if (level.value?.recursive && props.depth < (level.value.max_depth ?? 1)) {
    return { cycle: false, enabled: true, levelIndex: props.levelIndex, depth: props.depth + 1 }
  }
  const nextIndex = props.levelIndex + 1
  return {
    cycle: false,
    enabled: Boolean(props.levels[nextIndex]),
    levelIndex: nextIndex,
    depth: props.depth + 1,
  }
}
</script>

<template>
  <div v-if="level && relation" class="ml-5 border-l border-nc-border-gray-medium pl-3" role="group">
    <button
      type="button"
      class="my-1 flex items-center gap-1 rounded px-1 py-0.5 text-small text-nc-content-gray-subtle hover:bg-nc-bg-gray-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-nc-content-brand"
      :aria-expanded="expanded"
      :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${relation.title}`"
      @click.stop="toggle"
    >
      <GeneralIcon :icon="expanded ? 'chevronDown' : 'chevronRight'" class="h-3.5 w-3.5" />
      <span>{{ relation.title }}</span>
      <span v-if="loaded" class="text-nc-content-gray-muted">({{ totalRows }})</span>
    </button>

    <div v-if="expanded" class="space-y-1.5 pb-1" :aria-busy="loading">
      <div v-if="loading && !children.length" class="py-2 text-small text-nc-content-gray-muted">Loading linked records…</div>
      <div v-else-if="error" class="flex items-center gap-2 py-2 text-small text-nc-content-red">
        <span>{{ error }}</span>
        <NcButton size="xsmall" type="secondary" @click.stop="loadChildren(false)">Retry</NcButton>
      </div>
      <div v-else-if="!children.length && level.show_empty" class="py-2 text-small text-nc-content-gray-muted">
        No linked records
      </div>

      <div
        v-for="child in children"
        :key="identity(child)"
        class="rounded-md border border-nc-border-gray-medium bg-nc-bg-default px-3 py-2"
      >
        <div class="flex min-w-0 flex-wrap gap-x-5 gap-y-1">
          <div v-for="field in displayFields" :key="field.id" class="flex min-w-0 items-center gap-1.5 text-small">
            <span class="shrink-0 text-nc-content-gray-muted">{{ field.title }}</span>
            <span class="truncate text-nc-content-gray-emphasis">{{ formatValue(child[field.title!]) }}</span>
          </div>
        </div>

        <div v-if="nextLevel(child).cycle" class="mt-1 text-xs text-nc-content-orange">Cycle stopped</div>
        <SmartsheetListHierarchyNode
          v-else-if="nextLevel(child).enabled && relatedMeta"
          :record="child"
          :table-meta="relatedMeta"
          :levels="levels"
          :level-index="nextLevel(child).levelIndex"
          :depth="nextLevel(child).depth"
          :path="[...path, identity(child)]"
        />
      </div>

      <NcButton
        v-if="hasMore && children.length"
        size="xsmall"
        type="secondary"
        :loading="loading"
        @click.stop="loadChildren(true)"
      >
        Load more
      </NcButton>
    </div>
  </div>
</template>
