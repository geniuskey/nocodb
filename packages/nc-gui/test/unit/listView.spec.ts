import { UITypes } from 'nocodb-sdk'
import type { ColumnType } from 'nocodb-sdk'
import { describe, expect, it } from 'vitest'
import {
  parseListImageAttachment,
  resolveListColorField,
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
})
