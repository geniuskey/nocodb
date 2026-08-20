import { describe, expect, it } from 'vitest'
import { UITypes } from 'nocodb-sdk'

import { getColumnUidtByID, getSortDirectionOptions, isSortRelevantChange, sortByUIType } from '../../utils/sortUtils'

describe('getSortDirectionOptions', () => {
  it('uses numeric labels for number-like fields', () => {
    expect(getSortDirectionOptions(UITypes.Number)).toEqual([
      { text: '1 → 9', value: 'asc' },
      { text: '9 → 1', value: 'desc' },
    ])
  })

  it('adds count ordering when the field is grouped', () => {
    expect(getSortDirectionOptions(UITypes.SingleLineText, true)).toEqual([
      { text: 'A → Z', value: 'asc' },
      { text: 'Z → A', value: 'desc' },
      { text: 'Count (9 → 1)', value: 'count-desc' },
      { text: 'Count (1 → 9)', value: 'count-asc' },
    ])
  })
})

describe('sortByUIType', () => {
  const compare = (uidt: UITypes, a: unknown, b: unknown, direction: 'asc' | 'desc' = 'asc', caseSensitive = true) =>
    sortByUIType({ uidt, a, b, options: { direction, caseSensitive } })

  it('sorts numeric values numerically in both directions', () => {
    expect(compare(UITypes.Number, '2', '10')).toBeLessThan(0)
    expect(compare(UITypes.Number, '2', '10', 'desc')).toBeGreaterThan(0)
  })

  it('places null and empty values according to the existing direction contract', () => {
    expect(compare(UITypes.SingleLineText, null, 'a')).toBeLessThan(0)
    expect(compare(UITypes.SingleLineText, null, 'a', 'desc')).toBeGreaterThan(0)
    expect(compare(UITypes.SingleLineText, '', 'a')).toBeLessThan(0)
    expect(compare(UITypes.SingleLineText, '', 'a', 'desc')).toBeGreaterThan(0)
  })

  it('supports case-insensitive text ordering', () => {
    expect(compare(UITypes.SingleLineText, 'alpha', 'Bravo', 'asc', false)).toBeLessThan(0)
    expect(compare(UITypes.SingleLineText, 'Bravo', 'alpha', 'asc', false)).toBeGreaterThan(0)
  })

  it('sorts date-time and time values chronologically', () => {
    expect(compare(UITypes.DateTime, '2025-01-01T09:00:00Z', '2025-01-02T09:00:00Z')).toBeLessThan(0)
    expect(compare(UITypes.Time, '09:30', '10:00:00')).toBeLessThan(0)
  })

  it('sorts linked-record counts from numeric object values', () => {
    expect(compare(UITypes.Links, { count: 2 }, { count: 10 })).toBeLessThan(0)
  })

  it('sorts attachment and user values by their display fields', () => {
    expect(compare(UITypes.Attachment, [{ title: 'alpha.png' }], [{ title: 'beta.png' }])).toBeLessThan(0)
    expect(
      compare(
        UITypes.User,
        { display_name: 'Ada', email: 'ada@example.test' },
        { display_name: 'Grace', email: 'grace@example.test' },
      ),
    ).toBeLessThan(0)
  })
})

describe('sort metadata helpers', () => {
  const columns = {
    title: { id: 'title', title: 'Title', uidt: UITypes.SingleLineText },
    priority: { id: 'priority', title: 'Priority', uidt: UITypes.Number },
  }

  it('detects whether a changed field participates in active sorting', () => {
    const sorts = [{ fk_column_id: 'priority', direction: 'asc' }]

    expect(isSortRelevantChange(['Priority'], sorts, columns)).toBe(true)
    expect(isSortRelevantChange(['Title'], sorts, columns)).toBe(false)
  })

  it('resolves a column UI type from array and record inputs', () => {
    expect(getColumnUidtByID('priority', columns)).toBe(UITypes.Number)
    expect(getColumnUidtByID('title', Object.values(columns))).toBe(UITypes.SingleLineText)
    expect(getColumnUidtByID('missing', columns)).toBe('')
  })
})
