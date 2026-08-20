<script setup lang="ts">
import { comparisonOpList, comparisonSubOpList, isComparisonOpAllowed, parseProp } from 'nocodb-sdk'
import type { ColumnType, UITypes } from 'nocodb-sdk'
import type { ListColorRule } from '~/utils/listView'
import { adjustFilterWhenColumnChange, isComparisonSubOpAllowed } from '~/utils/filterUtils'
import { isListColorRuleColumn } from '~/utils/listView'

interface Props {
  rules: ListColorRule[]
  fields: ColumnType[]
  disabled?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (event: 'save', rules: ListColorRule[]): void
}>()

const palette = ['#4F46E5', '#2563EB', '#0891B2', '#059669', '#65A30D', '#D97706', '#DC2626', '#DB2777']
const draftRules = ref<ListColorRule[]>([])

watch(
  () => props.rules,
  (rules) => {
    draftRules.value = rules.map((rule) => ({ ...rule, meta: rule.meta ? { ...rule.meta } : undefined }))
  },
  { immediate: true, deep: true },
)

const eligibleFields = computed(() => props.fields.filter(isListColorRuleColumn))
const fieldFor = (rule: ListColorRule) => eligibleFields.value.find((field) => field.id === rule.fk_column_id)

const operatorOptions = (rule: ListColorRule) => {
  const field = fieldFor(rule)
  if (!field) return []

  return comparisonOpList(field.uidt as UITypes, parseProp(field.meta)?.date_format).filter((operator) =>
    isComparisonOpAllowed(rule as any, operator, field.uidt as UITypes, true),
  )
}

const subOperatorOptions = (rule: ListColorRule) => {
  const field = fieldFor(rule)
  if (!field || !rule.comparison_op) return []

  return comparisonSubOpList(rule.comparison_op, parseProp(field.meta)?.date_format).filter((operator) =>
    isComparisonSubOpAllowed(rule as any, operator, field.uidt as UITypes),
  )
}

const ignoresValue = (rule: ListColorRule) => {
  const subOperator = subOperatorOptions(rule).find((operator) => operator.value === rule.comparison_sub_op)
  if (subOperator) return !!subOperator.ignoreVal

  return !!operatorOptions(rule).find((operator) => operator.value === rule.comparison_op)?.ignoreVal
}

const emitSave = () =>
  emit(
    'save',
    draftRules.value.map((rule) => ({ ...rule, meta: rule.meta ? { ...rule.meta } : undefined })),
  )
const emitSaveDebounced = useDebounceFn(emitSave, 500)

const updateRule = (ruleId: string, updates: Partial<ListColorRule>, debounce = false) => {
  const index = draftRules.value.findIndex((rule) => rule.id === ruleId)
  if (index < 0) return

  draftRules.value[index] = { ...draftRules.value[index], ...updates }
  if (debounce) emitSaveDebounced()
  else emitSave()
}

const updateField = (rule: ListColorRule, fieldId: string) => {
  const field = eligibleFields.value.find((candidate) => candidate.id === fieldId)
  if (!field) return

  const nextRule = { ...rule, fk_column_id: fieldId, value: null }
  adjustFilterWhenColumnChange({
    filter: nextRule as any,
    column: field,
    showNullAndEmptyInFilter: true,
  })
  updateRule(rule.id, nextRule)
}

const updateOperator = (rule: ListColorRule, comparisonOp: string) => {
  const field = fieldFor(rule)
  if (!field) return

  const subOperators = comparisonSubOpList(comparisonOp, parseProp(field.meta)?.date_format).filter((operator) =>
    isComparisonSubOpAllowed(rule as any, operator, field.uidt as UITypes),
  )
  const comparisonSubOp = subOperators.some((operator) => operator.value === rule.comparison_sub_op)
    ? rule.comparison_sub_op
    : subOperators[0]?.value ?? null
  const ignoreValue =
    subOperators.find((operator) => operator.value === comparisonSubOp)?.ignoreVal ??
    operatorOptions(rule).find((operator) => operator.value === comparisonOp)?.ignoreVal

  updateRule(rule.id, {
    comparison_op: comparisonOp as ListColorRule['comparison_op'],
    comparison_sub_op: comparisonSubOp as ListColorRule['comparison_sub_op'],
    ...(ignoreValue ? { value: null } : {}),
  })
}

const addRule = () => {
  const field = eligibleFields.value[0]
  if (!field || draftRules.value.length >= 20) return

  const rule: ListColorRule = {
    id: `list-color-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fk_column_id: field.id!,
    comparison_op: 'eq',
    comparison_sub_op: null,
    value: null,
    color: palette[draftRules.value.length % palette.length],
  }
  adjustFilterWhenColumnChange({ filter: rule as any, column: field, showNullAndEmptyInFilter: true })
  draftRules.value.push(rule)
  emitSave()
}

const removeRule = (ruleId: string) => {
  draftRules.value = draftRules.value.filter((rule) => rule.id !== ruleId)
  emitSave()
}

const moveRule = (index: number, direction: -1 | 1) => {
  const target = index + direction
  if (target < 0 || target >= draftRules.value.length) return

  const next = [...draftRules.value]
  ;[next[index], next[target]] = [next[target], next[index]]
  draftRules.value = next
  emitSave()
}
</script>

<template>
  <div class="flex flex-col gap-2 border-t border-nc-border-gray-medium pt-3">
    <div class="flex items-center justify-between">
      <div>
        <div class="text-xs font-medium text-nc-content-gray-subtle2">{{ $t('labels.listConditionalColors') }}</div>
        <div class="text-[11px] text-nc-content-gray-muted">{{ $t('labels.listConditionalColorsHint') }}</div>
      </div>
      <NcButton
        data-testid="nc-list-add-color-rule"
        type="secondary"
        size="small"
        :disabled="disabled || !eligibleFields.length || draftRules.length >= 20"
        @click="addRule"
      >
        <div class="flex items-center gap-1">
          <GeneralIcon icon="plus" class="h-3.5 w-3.5" />
          {{ $t('general.add') }}
        </div>
      </NcButton>
    </div>

    <div v-if="!draftRules.length" class="rounded-lg bg-nc-bg-gray-light px-3 py-2 text-xs text-nc-content-gray-muted">
      {{ $t('labels.listNoConditionalColors') }}
    </div>

    <div
      v-for="(rule, index) in draftRules"
      :key="rule.id"
      :data-testid="`nc-list-color-rule-${index}`"
      class="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1 rounded-lg border border-nc-border-gray-medium p-1.5"
    >
      <NcSelect
        :value="rule.fk_column_id"
        :data-testid="`nc-list-color-rule-field-${index}`"
        :disabled="disabled"
        class="min-w-0"
        @change="(value) => updateField(rule, value)"
      >
        <a-select-option v-for="field in eligibleFields" :key="field.id" :value="field.id">
          <div class="flex items-center gap-1.5">
            <SmartsheetHeaderIcon :column="field" class="!h-3.5 !w-3.5" />
            <span class="truncate">{{ field.title }}</span>
          </div>
        </a-select-option>
      </NcSelect>

      <NcSelect
        :value="rule.comparison_op"
        :data-testid="`nc-list-color-rule-operator-${index}`"
        :disabled="disabled"
        class="min-w-0"
        @change="(value) => updateOperator(rule, value)"
      >
        <a-select-option v-for="operator in operatorOptions(rule)" :key="operator.value" :value="operator.value">
          {{ operator.text }}
        </a-select-option>
      </NcSelect>

      <div class="flex min-w-0 items-center gap-1">
        <NcSelect
          v-if="subOperatorOptions(rule).length"
          :value="rule.comparison_sub_op"
          :data-testid="`nc-list-color-rule-sub-operator-${index}`"
          :disabled="disabled"
          class="min-w-0 flex-1"
          @change="(value) => updateRule(rule.id, { comparison_sub_op: value, value: null })"
        >
          <a-select-option v-for="operator in subOperatorOptions(rule)" :key="operator.value" :value="operator.value">
            {{ operator.text }}
          </a-select-option>
        </NcSelect>
        <SmartsheetToolbarFilterInputLite
          v-if="!ignoresValue(rule)"
          :data-testid="`nc-list-color-rule-value-${index}`"
          class="min-w-0 flex-1"
          :column="fieldFor(rule)"
          :filter="rule"
          :disabled="disabled"
          @update-filter-value="(value) => updateRule(rule.id, { value }, true)"
        />
        <span v-else class="px-2 text-xs text-nc-content-gray-muted">—</span>
      </div>

      <div class="flex items-center gap-0.5">
        <GeneralAdvanceColorPickerDropdown
          :model-value="rule.color"
          :disabled="disabled"
          @update:model-value="(value) => updateRule(rule.id, { color: value })"
        />
        <NcButton type="text" size="small" :disabled="disabled || index === 0" @click="moveRule(index, -1)">
          <GeneralIcon icon="arrowUp" class="h-3.5 w-3.5" />
        </NcButton>
        <NcButton type="text" size="small" :disabled="disabled || index === draftRules.length - 1" @click="moveRule(index, 1)">
          <GeneralIcon icon="arrowDown" class="h-3.5 w-3.5" />
        </NcButton>
        <NcButton type="text" size="small" :disabled="disabled" @click="removeRule(rule.id)">
          <GeneralIcon icon="delete" class="h-3.5 w-3.5" />
        </NcButton>
      </div>
    </div>
  </div>
</template>
