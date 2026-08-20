import { UITypes, isSystemColumn, isVirtualCol, parseProp, validateRowFilters } from 'nocodb-sdk'
import type { ColumnType, FilterType, ListType, SelectOptionsType } from 'nocodb-sdk'

type ListPresentationConfig = Partial<ListType> & {
  fk_title_column_id?: string | null
  fk_subtitle_column_id?: string | null
  fk_image_column_id?: string | null
}

export const resolveListPresentationFields = (fields: ColumnType[], config: ListPresentationConfig) => {
  const columnById = fields.reduce<Record<string, ColumnType>>((columns, column) => {
    if (column.id) columns[column.id] = column
    return columns
  }, {})

  const titleField =
    (config.fk_title_column_id && columnById[config.fk_title_column_id]) || fields.find((column) => column.pv) || fields[0]

  const subtitleField =
    config.fk_subtitle_column_id === ''
      ? undefined
      : (config.fk_subtitle_column_id &&
          columnById[config.fk_subtitle_column_id]?.id !== titleField?.id &&
          columnById[config.fk_subtitle_column_id]) ||
        fields.find((column) => column.id !== titleField?.id && column.uidt !== UITypes.Attachment)

  const imageField =
    config.fk_image_column_id && columnById[config.fk_image_column_id]?.uidt === UITypes.Attachment
      ? columnById[config.fk_image_column_id]
      : undefined

  const detailFields = fields.filter(
    (column) => column.id !== titleField?.id && column.id !== subtitleField?.id && column.id !== imageField?.id,
  )

  return { titleField, subtitleField, imageField, detailFields }
}

export const parseListImageAttachment = (value: unknown): Record<string, any> | undefined => {
  if (!value) return undefined

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) return undefined

    return parsed
      .flat()
      .map((attachment) => (typeof attachment === 'string' ? JSON.parse(attachment) : attachment))
      .find(
        (attachment) =>
          attachment && !Array.isArray(attachment) && typeof attachment === 'object' && Object.keys(attachment).length,
      )
  } catch {
    return undefined
  }
}

export const resolveListColorField = (fields: ColumnType[], meta: unknown) => {
  const colorFieldId = parseProp(meta)?.color_by_field_id

  return fields.find((field) => field.id === colorFieldId && field.uidt === UITypes.SingleSelect)
}

export const resolveListRowColor = (record: Record<string, any>, colorField?: ColumnType): string | undefined => {
  if (!colorField?.title || colorField.uidt !== UITypes.SingleSelect) return undefined

  const value = record[colorField.title]
  if (value === null || value === undefined) return undefined

  const normalizedValue = String(value).trim()
  const option = (colorField.colOptions as SelectOptionsType | undefined)?.options?.find(
    (candidate) => String(candidate.title).trim() === normalizedValue,
  )

  return option?.color || undefined
}

export type ListColorCondition = Pick<FilterType, 'fk_column_id' | 'comparison_op' | 'comparison_sub_op' | 'value' | 'meta'> & {
  id: string
}

export interface ListColorRule {
  id: string
  color: string
  logical_op: 'and' | 'or'
  conditions: ListColorCondition[]
}

const listColorRuleUnsupportedTypes = new Set([
  UITypes.Attachment,
  UITypes.ForeignKey,
  UITypes.SpecificDBType,
  UITypes.Button,
  UITypes.Barcode,
  UITypes.QrCode,
  UITypes.Links,
  UITypes.LinkToAnotherRecord,
  UITypes.Lookup,
  UITypes.Rollup,
])

export const isListColorRuleColumn = (column: ColumnType) =>
  !!column.id && !!column.title && !isSystemColumn(column) && !listColorRuleUnsupportedTypes.has(column.uidt as UITypes)

const parseListColorCondition = (condition: any, fallbackId?: string): ListColorCondition | undefined => {
  if (
    !condition ||
    typeof condition !== 'object' ||
    (!fallbackId && typeof condition.id !== 'string') ||
    typeof condition.fk_column_id !== 'string' ||
    typeof condition.comparison_op !== 'string'
  ) {
    return undefined
  }

  return {
    id: fallbackId ?? condition.id,
    fk_column_id: condition.fk_column_id,
    comparison_op: condition.comparison_op,
    comparison_sub_op: condition.comparison_sub_op ?? null,
    value: condition.value,
    ...(condition.meta ? { meta: condition.meta } : {}),
  }
}

export const parseListColorRules = (meta: unknown): ListColorRule[] => {
  const rules = parseProp(meta)?.list_color_rules
  if (!Array.isArray(rules)) return []

  return rules
    .flatMap((rule) => {
      if (
        !rule ||
        typeof rule !== 'object' ||
        typeof rule.id !== 'string' ||
        typeof rule.color !== 'string' ||
        !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(rule.color)
      ) {
        return []
      }

      const rawConditions = Array.isArray(rule.conditions) ? rule.conditions : [rule]
      if (!rawConditions.length || rawConditions.length > 10) return []

      const conditions = rawConditions.map((condition, index) =>
        parseListColorCondition(condition, Array.isArray(rule.conditions) ? undefined : `${rule.id}-condition-${index + 1}`),
      )
      if (conditions.some((condition) => !condition)) return []

      return [
        {
          id: rule.id,
          color: rule.color,
          logical_op: rule.logical_op === 'or' ? 'or' : 'and',
          conditions: conditions as ListColorCondition[],
        },
      ]
    })
    .slice(0, 20)
}

export const resolveListConditionalRowColor = (
  record: Record<string, any>,
  fields: ColumnType[],
  rules: ListColorRule[],
  context: {
    client?: any
    metas?: Record<string, any>
    currentUser?: { id: string; email: string }
    timezone?: string
  } = {},
): string | undefined => {
  const eligibleFieldIds = new Set(fields.filter(isListColorRuleColumn).map((field) => field.id))

  for (const rule of rules) {
    if (!rule.conditions.length || rule.conditions.some((condition) => !eligibleFieldIds.has(condition.fk_column_id))) continue

    try {
      if (
        validateRowFilters({
          filters: rule.conditions.map((condition, index) => ({
            ...condition,
            logical_op: index === 0 ? 'and' : rule.logical_op,
          })),
          data: record,
          columns: fields,
          client: context.client,
          metas: context.metas ?? {},
          options: {
            currentUser: context.currentUser,
            timezone: context.timezone,
          },
        })
      ) {
        return rule.color
      }
    } catch {
      // A stale or type-incompatible rule must never prevent the List from rendering.
    }
  }

  return undefined
}

const listBulkUpdateUnsupportedTypes = new Set([UITypes.Attachment, UITypes.ForeignKey, UITypes.SpecificDBType])

export const isListBulkUpdateColumn = (column: ColumnType) =>
  !!column.id &&
  !!column.title &&
  !column.readonly &&
  !column.pk &&
  !column.ai &&
  !column.unique &&
  !isSystemColumn(column) &&
  !isVirtualCol(column) &&
  !listBulkUpdateUnsupportedTypes.has(column.uidt as UITypes)

export const buildListBulkUpdateData = (
  updates: Array<{ field: ColumnType; value: any }>,
  allowedFields: ColumnType[],
): Record<string, any> | undefined => {
  if (!updates.length) return undefined

  const allowedFieldIds = new Set(allowedFields.map((field) => field.id).filter(Boolean))
  const usedFieldIds = new Set<string>()
  const data: Record<string, any> = {}

  for (const { field, value } of updates) {
    if (!field.id || !field.title || !allowedFieldIds.has(field.id) || usedFieldIds.has(field.id)) return undefined

    usedFieldIds.add(field.id)
    data[field.title] = value
  }

  return data
}
