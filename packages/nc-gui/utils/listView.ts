import { UITypes, parseProp } from 'nocodb-sdk'
import type { ColumnType, ListType, SelectOptionsType } from 'nocodb-sdk'

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
