import type { ComputedRef, Ref } from 'vue'
import { computed, ref, watch } from 'vue'

export interface ViewRowSelectionOptions<T> {
  rows: Ref<T[]> | ComputedRef<T[]>
  isSelected: (row: T) => boolean
  setSelected: (row: T, selected: boolean) => void
  focusRow?: (index: number) => void | Promise<void>
  getRowKey?: (row: T) => string | null | undefined
  getSelectionValue?: (row: T) => unknown
  totalRows?: Ref<number | undefined> | ComputedRef<number | undefined>
}

export interface ViewRowKeyboardOptions<T> {
  onOpen?: (row: T, index: number) => void
}

/**
 * Presentation-agnostic row selection for record views.
 *
 * Without a row key, selection remains page-scoped and is stored by the caller.
 * A row key enables persistent explicit selection and an all-matching mode whose
 * exclusions can be passed to server-side bulk operations.
 */
export function useViewRowSelection<T>(options: ViewRowSelectionOptions<T>) {
  const activeIndex = ref<number | null>(null)
  const anchorIndex = ref<number | null>(null)
  const selectedValuesByKey = ref(new Map<string, unknown>())
  const excludedValuesByKey = ref(new Map<string, unknown>())
  const isAllMatchingSelected = ref(false)

  const selectedRows = computed(() => options.rows.value.filter(options.isSelected))
  const canSelectAllMatching = computed(
    () => !!options.getRowKey && options.rows.value.length > 0 && options.rows.value.every((row) => !!options.getRowKey?.(row)),
  )
  const selectedCount = computed(() => {
    if (!options.getRowKey) return selectedRows.value.length

    if (isAllMatchingSelected.value) {
      return Math.max(0, (options.totalRows?.value ?? 0) - excludedValuesByKey.value.size)
    }

    const selectedRowsWithoutKey = selectedRows.value.filter((row) => !options.getRowKey?.(row)).length
    return selectedValuesByKey.value.size + selectedRowsWithoutKey
  })
  const hasSelection = computed(() => selectedCount.value > 0)

  const updateMap = (map: Ref<Map<string, unknown>>, key: string, value?: unknown) => {
    const next = new Map(map.value)

    if (value === undefined) next.delete(key)
    else next.set(key, value)

    map.value = next
  }

  const selectionValue = (row: T) => options.getSelectionValue?.(row) ?? row

  const setRowSelected = (row: T, selected: boolean) => {
    options.setSelected(row, selected)

    const key = options.getRowKey?.(row)
    if (!key) return

    if (isAllMatchingSelected.value) {
      updateMap(excludedValuesByKey, key, selected ? undefined : selectionValue(row))
    } else {
      updateMap(selectedValuesByKey, key, selected ? selectionValue(row) : undefined)
    }
  }

  const allSelected = computed({
    get: () => options.rows.value.length > 0 && selectedRows.value.length === options.rows.value.length,
    set: (selected: boolean) => {
      for (const row of options.rows.value) setRowSelected(row, selected)
      if (!selected) anchorIndex.value = null
    },
  })
  const isIndeterminate = computed(() => selectedRows.value.length > 0 && !allSelected.value)
  const selectedValues = computed(() => Array.from(selectedValuesByKey.value.values()))
  const excludedValues = computed(() => Array.from(excludedValuesByKey.value.values()))
  const excludedKeys = computed(() => Array.from(excludedValuesByKey.value.keys()))

  const isValidIndex = (index: number) => index >= 0 && index < options.rows.value.length

  const clearSelection = () => {
    for (const row of options.rows.value) options.setSelected(row, false)
    selectedValuesByKey.value = new Map()
    excludedValuesByKey.value = new Map()
    isAllMatchingSelected.value = false
    anchorIndex.value = null
  }

  const selectAllMatching = () => {
    if (!canSelectAllMatching.value || !options.totalRows?.value) return

    selectedValuesByKey.value = new Map()
    excludedValuesByKey.value = new Map()
    isAllMatchingSelected.value = true
    for (const row of options.rows.value) options.setSelected(row, true)
  }

  const selectRange = (from: number, to: number) => {
    if (!isValidIndex(from) || !isValidIndex(to)) return

    const start = Math.min(from, to)
    const end = Math.max(from, to)

    for (const [index, row] of options.rows.value.entries()) {
      setRowSelected(row, index >= start && index <= end)
    }
  }

  const toggleRow = (index: number, extend = false) => {
    if (!isValidIndex(index)) return

    activeIndex.value = index

    if (extend && anchorIndex.value !== null) {
      selectRange(anchorIndex.value, index)
      return
    }

    const row = options.rows.value[index]
    setRowSelected(row, !options.isSelected(row))
    anchorIndex.value = index
  }

  const onRowFocus = (index: number) => {
    if (!isValidIndex(index)) return
    activeIndex.value = index
    anchorIndex.value ??= index
  }

  const moveFocus = async (currentIndex: number, targetIndex: number, extend: boolean) => {
    if (!isValidIndex(targetIndex)) return

    if (extend) {
      anchorIndex.value ??= currentIndex
      selectRange(anchorIndex.value, targetIndex)
    } else {
      anchorIndex.value = targetIndex
    }

    activeIndex.value = targetIndex
    await options.focusRow?.(targetIndex)
  }

  const onRowKeydown = async (event: KeyboardEvent, index: number, keyboardOptions: ViewRowKeyboardOptions<T> = {}) => {
    if (!isValidIndex(index)) return

    const lastIndex = options.rows.value.length - 1
    let targetIndex: number | undefined

    switch (event.key) {
      case 'ArrowUp':
        targetIndex = Math.max(0, index - 1)
        break
      case 'ArrowDown':
        targetIndex = Math.min(lastIndex, index + 1)
        break
      case 'Home':
        targetIndex = 0
        break
      case 'End':
        targetIndex = lastIndex
        break
      case ' ':
      case 'Spacebar':
        event.preventDefault()
        toggleRow(index, event.shiftKey)
        return
      case 'Enter':
        event.preventDefault()
        keyboardOptions.onOpen?.(options.rows.value[index], index)
        return
      case 'Escape':
        if (hasSelection.value) {
          event.preventDefault()
          clearSelection()
        }
        return
      case 'a':
      case 'A':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          allSelected.value = true
        }
        return
      default:
        return
    }

    event.preventDefault()
    await moveFocus(index, targetIndex, event.shiftKey)
  }

  watch(
    options.rows,
    () => {
      activeIndex.value = null
      anchorIndex.value = null

      if (!options.getRowKey) return

      for (const row of options.rows.value) {
        const key = options.getRowKey(row)
        options.setSelected(
          row,
          !!key && (isAllMatchingSelected.value ? !excludedValuesByKey.value.has(key) : selectedValuesByKey.value.has(key)),
        )
      }
    },
    { flush: 'sync' },
  )

  return {
    activeIndex,
    selectedRows,
    selectedCount,
    hasSelection,
    allSelected,
    isIndeterminate,
    isAllMatchingSelected,
    canSelectAllMatching,
    selectedValues,
    excludedValues,
    excludedKeys,
    clearSelection,
    selectAllMatching,
    selectRange,
    toggleRow,
    onRowFocus,
    onRowKeydown,
  }
}
