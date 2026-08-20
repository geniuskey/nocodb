import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useViewRowSelection } from '../../composables/useViewRowSelection'

interface TestRow {
  id: number
  selected: boolean
}

const createSelection = () => {
  const rows = ref<TestRow[]>(
    Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      selected: false,
    })),
  )
  const focusRow = vi.fn()
  const selection = useViewRowSelection({
    rows,
    isSelected: (row) => row.selected,
    setSelected: (row, selected) => {
      row.selected = selected
    },
    focusRow,
  })

  return { rows, focusRow, selection }
}

const createPersistentSelection = () => {
  const rows = ref<TestRow[]>([
    { id: 1, selected: false },
    { id: 2, selected: false },
  ])
  const totalRows = ref(4)
  const selection = useViewRowSelection({
    rows,
    totalRows,
    getRowKey: (row) => String(row.id),
    getSelectionValue: (row) => ({ id: row.id }),
    isSelected: (row) => row.selected,
    setSelected: (row, selected) => {
      row.selected = selected
    },
  })

  return { rows, totalRows, selection }
}

const keyboardEvent = (key: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key, ...init })

describe('useViewRowSelection', () => {
  it('toggles rows and exposes selected state', () => {
    const { rows, selection } = createSelection()

    selection.toggleRow(1)
    selection.toggleRow(3)

    expect(selection.selectedRows.value.map((row) => row.id)).toEqual([2, 4])
    expect(selection.selectedCount.value).toBe(2)
    expect(selection.isIndeterminate.value).toBe(true)

    selection.allSelected.value = true
    expect(rows.value.every((row) => row.selected)).toBe(true)
    expect(selection.allSelected.value).toBe(true)

    selection.clearSelection()
    expect(selection.hasSelection.value).toBe(false)
  })

  it('extends a selection from its anchor', async () => {
    const { selection } = createSelection()

    selection.toggleRow(1)
    await selection.onRowKeydown(keyboardEvent('ArrowDown', { shiftKey: true }), 1)
    await selection.onRowKeydown(keyboardEvent('ArrowDown', { shiftKey: true }), 2)

    expect(selection.selectedRows.value.map((row) => row.id)).toEqual([2, 3, 4])
    expect(selection.activeIndex.value).toBe(3)
  })

  it('supports roving focus and boundary keys without changing selection', async () => {
    const { focusRow, selection } = createSelection()

    await selection.onRowKeydown(keyboardEvent('ArrowDown'), 0)
    await selection.onRowKeydown(keyboardEvent('End'), 1)
    await selection.onRowKeydown(keyboardEvent('Home'), 4)

    expect(focusRow.mock.calls).toEqual([[1], [4], [0]])
    expect(selection.selectedCount.value).toBe(0)
  })

  it('opens, selects all, and clears using standard keyboard commands', async () => {
    const { rows, selection } = createSelection()
    const onOpen = vi.fn()

    await selection.onRowKeydown(keyboardEvent('Enter'), 2, { onOpen })
    expect(onOpen).toHaveBeenCalledWith(rows.value[2], 2)

    await selection.onRowKeydown(keyboardEvent('a', { ctrlKey: true }), 2)
    expect(selection.selectedCount.value).toBe(5)

    await selection.onRowKeydown(keyboardEvent('Escape'), 2)
    expect(selection.selectedCount.value).toBe(0)
  })

  it('resets focus state when the row page changes', () => {
    const { rows, selection } = createSelection()

    selection.onRowFocus(3)
    rows.value = [{ id: 6, selected: false }]

    expect(selection.activeIndex.value).toBeNull()
  })

  it('preserves explicit selections when the loaded page changes', () => {
    const { rows, selection } = createPersistentSelection()

    selection.toggleRow(0)
    rows.value = [
      { id: 3, selected: false },
      { id: 4, selected: false },
    ]
    selection.toggleRow(1)

    expect(selection.selectedCount.value).toBe(2)
    expect(selection.selectedValues.value).toEqual([{ id: 1 }, { id: 4 }])
    expect(rows.value.map((row) => row.selected)).toEqual([false, true])

    rows.value = [
      { id: 1, selected: false },
      { id: 2, selected: false },
    ]
    expect(rows.value.map((row) => row.selected)).toEqual([true, false])
  })

  it('selects every matching record and tracks exclusions by key', () => {
    const { rows, totalRows, selection } = createPersistentSelection()

    selection.selectAllMatching()
    expect(selection.isAllMatchingSelected.value).toBe(true)
    expect(selection.selectedCount.value).toBe(4)
    expect(rows.value.every((row) => row.selected)).toBe(true)

    rows.value = [
      { id: 3, selected: false },
      { id: 4, selected: false },
    ]
    expect(rows.value.every((row) => row.selected)).toBe(true)

    selection.toggleRow(0)
    expect(selection.selectedCount.value).toBe(3)
    expect(selection.excludedValues.value).toEqual([{ id: 3 }])

    totalRows.value = 3
    expect(selection.selectedCount.value).toBe(2)

    selection.clearSelection()
    expect(selection.isAllMatchingSelected.value).toBe(false)
    expect(selection.selectedCount.value).toBe(0)
    expect(rows.value.every((row) => !row.selected)).toBe(true)
  })

  it('keeps selection page-scoped when rows have no persistent key', () => {
    const rows = ref<TestRow[]>([{ id: 1, selected: false }])
    const selection = useViewRowSelection({
      rows,
      totalRows: ref(3),
      getRowKey: () => undefined,
      isSelected: (row) => row.selected,
      setSelected: (row, selected) => {
        row.selected = selected
      },
    })

    selection.toggleRow(0)
    expect(selection.selectedCount.value).toBe(1)
    expect(selection.canSelectAllMatching.value).toBe(false)

    selection.selectAllMatching()
    expect(selection.isAllMatchingSelected.value).toBe(false)
  })
})
