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
})
