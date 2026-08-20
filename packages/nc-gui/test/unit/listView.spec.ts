import { UITypes } from 'nocodb-sdk'
import type { ColumnType } from 'nocodb-sdk'
import { describe, expect, it } from 'vitest'
import {
  isListBulkUpdateColumn,
  isListColorRuleColumn,
  parseListColorRules,
  parseListImageAttachment,
  resolveListColorField,
  resolveListConditionalRowColor,
  resolveListPresentationFields,
  resolveListRowColor,
} from '../../utils/listView'

const fields = [
  { id: 'title', title: 'Title', pv: true, uidt: UITypes.SingleLineText },
  {
    id: 'status',
    title: 'Status',
    uidt: UITypes.SingleSelect,
    colOptions: {
      options: [
        { title: 'Ready', color: '#cfdffe' },
        { title: 'Blocked', color: '#ffdce5' },
      ],
    },
  },
  { id: 'notes', title: 'Notes', uidt: UITypes.LongText },
  { id: 'image', title: 'Image', uidt: UITypes.Attachment },
] as ColumnType[]

describe('List view presentation', () => {
  it('uses primary and secondary visible fields by default', () => {
    const resolved = resolveListPresentationFields(fields, {})
    const resolvedFromDatabaseDefaults = resolveListPresentationFields(fields, { fk_subtitle_column_id: null })

    expect(resolved.titleField?.id).toBe('title')
    expect(resolved.subtitleField?.id).toBe('status')
    expect(resolvedFromDatabaseDefaults.subtitleField?.id).toBe('status')
    expect(resolved.imageField).toBeUndefined()
    expect(resolved.detailFields.map((field) => field.id)).toEqual(['notes', 'image'])
  })

  it('resolves saved title, subtitle, and attachment fields without duplicating details', () => {
    const resolved = resolveListPresentationFields(fields, {
      fk_title_column_id: 'notes',
      fk_subtitle_column_id: 'status',
      fk_image_column_id: 'image',
    })

    expect(resolved.titleField?.id).toBe('notes')
    expect(resolved.subtitleField?.id).toBe('status')
    expect(resolved.imageField?.id).toBe('image')
    expect(resolved.detailFields.map((field) => field.id)).toEqual(['title'])
  })

  it('honors an explicitly empty subtitle and ignores unavailable configuration', () => {
    const resolved = resolveListPresentationFields(fields, {
      fk_title_column_id: 'hidden',
      fk_subtitle_column_id: '',
      fk_image_column_id: 'status',
    })

    expect(resolved.titleField?.id).toBe('title')
    expect(resolved.subtitleField).toBeUndefined()
    expect(resolved.imageField).toBeUndefined()
  })

  it('extracts the first valid attachment from API and serialized cell values', () => {
    const attachment = { title: 'cover.png', url: 'https://example.test/cover.png' }

    expect(parseListImageAttachment([attachment])).toEqual(attachment)
    expect(parseListImageAttachment(JSON.stringify([JSON.stringify(attachment)]))).toEqual(attachment)
    expect(parseListImageAttachment('invalid')).toBeUndefined()
    expect(parseListImageAttachment({ value: attachment })).toBeUndefined()
  })

  it('resolves List-only select coloring without using the shared row-color system', () => {
    const colorField = resolveListColorField(fields, JSON.stringify({ color_by_field_id: 'status' }))

    expect(colorField?.id).toBe('status')
    expect(resolveListRowColor({ Status: ' Ready ' }, colorField)).toBe('#cfdffe')
    expect(resolveListRowColor({ Status: 'Unknown' }, colorField)).toBeUndefined()
    expect(resolveListColorField(fields, { color_by_field_id: 'notes' })).toBeUndefined()
    expect(resolveListColorField(fields.slice(0, 1), { color_by_field_id: 'status' })).toBeUndefined()
  })

  it('parses and evaluates ordered List-only conditional color rules', () => {
    const rules = parseListColorRules({
      list_color_rules: [
        {
          id: 'blocked',
          fk_column_id: 'status',
          comparison_op: 'eq',
          value: 'Blocked',
          color: '#dc2626',
        },
        {
          id: 'urgent',
          fk_column_id: 'notes',
          comparison_op: 'like',
          value: 'urgent',
          color: '#d97706',
        },
      ],
    })

    expect(rules).toHaveLength(2)
    expect(resolveListConditionalRowColor({ Status: 'Blocked', Notes: 'urgent' }, fields, rules, { client: 'pg' })).toBe(
      '#dc2626',
    )
    expect(resolveListConditionalRowColor({ Status: 'Ready', Notes: 'urgent request' }, fields, rules, { client: 'pg' })).toBe(
      '#d97706',
    )
    expect(resolveListConditionalRowColor({ Status: 'Ready', Notes: 'routine' }, fields, rules, { client: 'pg' })).toBeUndefined()
  })

  it('ignores malformed, stale, and unsupported List color rules', () => {
    const rules = parseListColorRules({
      list_color_rules: [
        { id: 'bad-color', fk_column_id: 'status', comparison_op: 'eq', value: 'Ready', color: 'red' },
        { id: 'stale', fk_column_id: 'missing', comparison_op: 'eq', value: 'Ready', color: '#2563eb' },
        { id: 'image', fk_column_id: 'image', comparison_op: 'blank', color: '#059669' },
      ],
    })

    expect(rules.map((rule) => rule.id)).toEqual(['stale', 'image'])
    expect(resolveListConditionalRowColor({ Status: 'Ready' }, fields, rules, { client: 'pg' })).toBeUndefined()
    expect(isListColorRuleColumn(fields[1])).toBe(true)
    expect(isListColorRuleColumn(fields[3])).toBe(false)
  })

  it('only offers ordinary mutable fields for bulk update', () => {
    expect(isListBulkUpdateColumn(fields[0])).toBe(true)
    expect(isListBulkUpdateColumn(fields[1])).toBe(true)
    expect(isListBulkUpdateColumn(fields[3])).toBe(false)
    expect(isListBulkUpdateColumn({ id: 'pk', title: 'Id', uidt: UITypes.ID, pk: true })).toBe(false)
    expect(isListBulkUpdateColumn({ id: 'formula', title: 'Total', uidt: UITypes.Formula })).toBe(false)
    expect(isListBulkUpdateColumn({ id: 'unique', title: 'Code', uidt: UITypes.SingleLineText, unique: true })).toBe(false)
    expect(isListBulkUpdateColumn({ id: 'readonly', title: 'Locked', uidt: UITypes.SingleLineText, readonly: true })).toBe(false)
  })
})
