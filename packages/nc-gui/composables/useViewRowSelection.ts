import type { ComputedRef, Ref } from 'vue'
import { computed, ref, watch } from 'vue'

export interface ViewRowSelectionOptions<T> {
  rows: Ref<T[]> | ComputedRef<T[]>
  isSelected: (row: T) => boolean
  setSelected: (row: T, selected: boolean) => void
  focusRow?: (index: number) => void | Promise<void>
}

export interface ViewRowKeyboardOptions<T> {
  onOpen?: (row: T, index: number) => void
}

/**
 * Page-scoped, presentation-agnostic row selection for record views.
 *
 * Selection is stored by the caller so existing data operations can consume it.
 * This composable owns only focus, range-selection, and keyboard semantics.
 */
export function useViewRowSelection<T>(options: ViewRowSelectionOptions<T>) {
  const activeIndex = ref<number | null>(null)
  const anchorIndex = ref<number | null>(null)

  const selectedRows = computed(() => options.rows.value.filter(options.isSelected))
  const selectedCount = computed(() => selectedRows.value.length)
  const hasSelection = computed(() => selectedCount.value > 0)
  const allSelected = computed({
    get: () => options.rows.value.length > 0 && selectedCount.value === options.rows.value.length,
    set: (selected: boolean) => {
      for (const row of options.rows.value) options.setSelected(row, selected)
      if (!selected) anchorIndex.value = null
    },
  })
  const isIndeterminate = computed(() => hasSelection.value && !allSelected.value)

  const isValidIndex = (index: number) => index >= 0 && index < options.rows.value.length

  const clearSelection = () => {
    for (const row of options.rows.value) options.setSelected(row, false)
    anchorIndex.value = null
  }

  const selectRange = (from: number, to: number) => {
    if (!isValidIndex(from) || !isValidIndex(to)) return

    const start = Math.min(from, to)
    const end = Math.max(from, to)

    for (const [index, row] of options.rows.value.entries()) {
      options.setSelected(row, index >= start && index <= end)
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
    options.setSelected(row, !options.isSelected(row))
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
    clearSelection,
    selectRange,
    toggleRow,
    onRowFocus,
    onRowKeydown,
  }
}
