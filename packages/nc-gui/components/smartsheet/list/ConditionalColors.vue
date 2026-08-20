<script setup lang="ts">
import { comparisonOpList, comparisonSubOpList, isComparisonOpAllowed, parseProp } from 'nocodb-sdk'
import type { ColumnType, UITypes } from 'nocodb-sdk'
import type { ListColorCondition, ListColorRule } from '~/utils/listView'
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

const cloneRule = (rule: ListColorRule): ListColorRule => ({
  ...rule,
  conditions: rule.conditions.map((condition) => ({
    ...condition,
    meta: condition.meta ? { ...condition.meta } : undefined,
  })),
})

watch(
  () => props.rules,
  (rules) => {
    draftRules.value = rules.map(cloneRule)
  },
  { immediate: true, deep: true },
)

const eligibleFields = computed(() => props.fields.filter(isListColorRuleColumn))
const fieldFor = (condition: ListColorCondition) => eligibleFields.value.find((field) => field.id === condition.fk_column_id)

const operatorOptions = (condition: ListColorCondition) => {
  const field = fieldFor(condition)
  if (!field) return []

  return comparisonOpList(field.uidt as UITypes, parseProp(field.meta)?.date_format).filter((operator) =>
    isComparisonOpAllowed(condition as any, operator, field.uidt as UITypes, true),
  )
}

const subOperatorOptions = (condition: ListColorCondition) => {
  const field = fieldFor(condition)
  if (!field || !condition.comparison_op) return []

  return comparisonSubOpList(condition.comparison_op, parseProp(field.meta)?.date_format).filter((operator) =>
    isComparisonSubOpAllowed(condition as any, operator, field.uidt as UITypes),
  )
}

const ignoresValue = (condition: ListColorCondition) => {
  const subOperator = subOperatorOptions(condition).find((operator) => operator.value === condition.comparison_sub_op)
  if (subOperator) return !!subOperator.ignoreVal

  return !!operatorOptions(condition).find((operator) => operator.value === condition.comparison_op)?.ignoreVal
}

const emitSave = () => emit('save', draftRules.value.map(cloneRule))
const emitSaveDebounced = useDebounceFn(emitSave, 500)

const updateRule = (ruleId: string, updates: Partial<ListColorRule>) => {
  const index = draftRules.value.findIndex((rule) => rule.id === ruleId)
  if (index < 0) return

  draftRules.value[index] = { ...draftRules.value[index], ...updates }
  emitSave()
}

const updateLogicalOperator = (ruleId: string, logicalOperator: string) => {
  if (!['and', 'or'].includes(logicalOperator)) return
  updateRule(ruleId, { logical_op: logicalOperator as ListColorRule['logical_op'] })
}

const updateCondition = (ruleId: string, conditionId: string, updates: Partial<ListColorCondition>, debounce = false) => {
  const ruleIndex = draftRules.value.findIndex((rule) => rule.id === ruleId)
  if (ruleIndex < 0) return

  const conditionIndex = draftRules.value[ruleIndex].conditions.findIndex((condition) => condition.id === conditionId)
  if (conditionIndex < 0) return

  const conditions = [...draftRules.value[ruleIndex].conditions]
  conditions[conditionIndex] = { ...conditions[conditionIndex], ...updates }
  draftRules.value[ruleIndex] = { ...draftRules.value[ruleIndex], conditions }
  if (debounce) emitSaveDebounced()
  else emitSave()
}

const updateField = (rule: ListColorRule, condition: ListColorCondition, fieldId: string) => {
  const field = eligibleFields.value.find((candidate) => candidate.id === fieldId)
  if (!field) return

  const nextCondition = { ...condition, fk_column_id: fieldId, value: null }
  adjustFilterWhenColumnChange({
    filter: nextCondition as any,
    column: field,
    showNullAndEmptyInFilter: true,
  })
  updateCondition(rule.id, condition.id, nextCondition)
}

const updateOperator = (rule: ListColorRule, condition: ListColorCondition, comparisonOp: string) => {
  const field = fieldFor(condition)
  if (!field) return

  const subOperators = comparisonSubOpList(comparisonOp, parseProp(field.meta)?.date_format).filter((operator) =>
    isComparisonSubOpAllowed(condition as any, operator, field.uidt as UITypes),
  )
  const comparisonSubOp = subOperators.some((operator) => operator.value === condition.comparison_sub_op)
    ? condition.comparison_sub_op
    : subOperators[0]?.value ?? null
  const ignoreValue =
    subOperators.find((operator) => operator.value === comparisonSubOp)?.ignoreVal ??
    operatorOptions(condition).find((operator) => operator.value === comparisonOp)?.ignoreVal

  updateCondition(rule.id, condition.id, {
    comparison_op: comparisonOp as ListColorCondition['comparison_op'],
    comparison_sub_op: comparisonSubOp as ListColorCondition['comparison_sub_op'],
    ...(ignoreValue ? { value: null } : {}),
  })
}

const createCondition = (): ListColorCondition | undefined => {
  const field = eligibleFields.value[0]
  if (!field) return undefined

  const condition: ListColorCondition = {
    id: `list-color-condition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fk_column_id: field.id!,
    comparison_op: 'eq',
    comparison_sub_op: null,
    value: null,
  }
  adjustFilterWhenColumnChange({ filter: condition as any, column: field, showNullAndEmptyInFilter: true })
  return condition
}

const addRule = () => {
  const condition = createCondition()
  if (!condition || draftRules.value.length >= 20) return

  draftRules.value.push({
    id: `list-color-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    color: palette[draftRules.value.length % palette.length],
    logical_op: 'and',
    conditions: [condition],
  })
  emitSave()
}

const addCondition = (rule: ListColorRule) => {
  const condition = createCondition()
  if (!condition || rule.conditions.length >= 10) return

  updateRule(rule.id, { conditions: [...rule.conditions, condition] })
}

const removeCondition = (rule: ListColorRule, conditionId: string) => {
  if (rule.conditions.length === 1) return
  updateRule(rule.id, { conditions: rule.conditions.filter((condition) => condition.id !== conditionId) })
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

const conditionTestId = (name: string, ruleIndex: number, conditionIndex: number) =>
  conditionIndex === 0 ? `nc-list-color-rule-${name}-${ruleIndex}` : `nc-list-color-rule-${name}-${ruleIndex}-${conditionIndex}`
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
      v-for="(rule, ruleIndex) in draftRules"
      :key="rule.id"
      :data-testid="`nc-list-color-rule-${ruleIndex}`"
      class="flex flex-col gap-2 rounded-lg border border-nc-border-gray-medium p-2"
    >
      <div class="flex items-center justify-between gap-2">
        <NcSelect
          :value="rule.logical_op"
          :data-testid="`nc-list-color-rule-logical-${ruleIndex}`"
          :disabled="disabled || rule.conditions.length < 2"
          class="w-36"
          @change="(value) => updateLogicalOperator(rule.id, value)"
        >
          <a-select-option value="and">{{ $t('labels.listMatchAll') }}</a-select-option>
          <a-select-option value="or">{{ $t('labels.listMatchAny') }}</a-select-option>
        </NcSelect>

        <div class="flex items-center gap-0.5">
          <GeneralAdvanceColorPickerDropdown
            :model-value="rule.color"
            :disabled="disabled"
            @update:model-value="(value) => updateRule(rule.id, { color: value })"
          />
          <NcButton type="text" size="small" :disabled="disabled || ruleIndex === 0" @click="moveRule(ruleIndex, -1)">
            <GeneralIcon icon="arrowUp" class="h-3.5 w-3.5" />
          </NcButton>
          <NcButton
            type="text"
            size="small"
            :disabled="disabled || ruleIndex === draftRules.length - 1"
            @click="moveRule(ruleIndex, 1)"
          >
            <GeneralIcon icon="arrowDown" class="h-3.5 w-3.5" />
          </NcButton>
          <NcButton type="text" size="small" :disabled="disabled" @click="removeRule(rule.id)">
            <GeneralIcon icon="delete" class="h-3.5 w-3.5" />
          </NcButton>
        </div>
      </div>

      <div
        v-for="(condition, conditionIndex) in rule.conditions"
        :key="condition.id"
        :data-testid="`nc-list-color-rule-condition-${ruleIndex}-${conditionIndex}`"
        class="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1"
      >
        <NcSelect
          :value="condition.fk_column_id"
          :data-testid="conditionTestId('field', ruleIndex, conditionIndex)"
          :disabled="disabled"
          class="min-w-0"
          @change="(value) => updateField(rule, condition, value)"
        >
          <a-select-option v-for="field in eligibleFields" :key="field.id" :value="field.id">
            <div class="flex items-center gap-1.5">
              <SmartsheetHeaderIcon :column="field" class="!h-3.5 !w-3.5" />
              <span class="truncate">{{ field.title }}</span>
            </div>
          </a-select-option>
        </NcSelect>

        <NcSelect
          :value="condition.comparison_op"
          :data-testid="conditionTestId('operator', ruleIndex, conditionIndex)"
          :disabled="disabled"
          class="min-w-0"
          @change="(value) => updateOperator(rule, condition, value)"
        >
          <a-select-option v-for="operator in operatorOptions(condition)" :key="operator.value" :value="operator.value">
            {{ operator.text }}
          </a-select-option>
        </NcSelect>

        <div class="flex min-w-0 items-center gap-1">
          <NcSelect
            v-if="subOperatorOptions(condition).length"
            :value="condition.comparison_sub_op"
            :data-testid="conditionTestId('sub-operator', ruleIndex, conditionIndex)"
            :disabled="disabled"
            class="min-w-0 flex-1"
            @change="(value) => updateCondition(rule.id, condition.id, { comparison_sub_op: value, value: null })"
          >
            <a-select-option v-for="operator in subOperatorOptions(condition)" :key="operator.value" :value="operator.value">
              {{ operator.text }}
            </a-select-option>
          </NcSelect>
          <SmartsheetToolbarFilterInputLite
            v-if="!ignoresValue(condition)"
            :data-testid="conditionTestId('value', ruleIndex, conditionIndex)"
            class="min-w-0 flex-1"
            :column="fieldFor(condition)"
            :filter="condition"
            :disabled="disabled"
            @update-filter-value="(value) => updateCondition(rule.id, condition.id, { value }, true)"
          />
          <span v-else class="px-2 text-xs text-nc-content-gray-muted">—</span>
        </div>

        <NcButton
          :data-testid="`nc-list-color-rule-remove-condition-${ruleIndex}-${conditionIndex}`"
          type="text"
          size="small"
          :disabled="disabled || rule.conditions.length === 1"
          @click="removeCondition(rule, condition.id)"
        >
          <GeneralIcon icon="delete" class="h-3.5 w-3.5" />
        </NcButton>
      </div>

      <NcButton
        :data-testid="`nc-list-color-rule-add-condition-${ruleIndex}`"
        class="self-start"
        type="text"
        size="small"
        :disabled="disabled || rule.conditions.length >= 10"
        @click="addCondition(rule)"
      >
        <div class="flex items-center gap-1">
          <GeneralIcon icon="plus" class="h-3.5 w-3.5" />
          {{ $t('labels.addCondition') }}
        </div>
      </NcButton>
    </div>
  </div>
</template>
