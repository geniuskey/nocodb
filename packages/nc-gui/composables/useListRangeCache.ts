import type { PaginatedType } from 'nocodb-sdk'
import { ref } from 'vue'
import type { ViewDataRange } from './useViewData'

export const LIST_RANGE_CACHE_LIMIT = 3

export const getListAdjacentRangePages = ({ page, pageSize, totalRows }: PaginatedType) => {
  const currentPage = page ?? 1
  const size = pageSize ?? 25
  const lastPage = Math.max(1, Math.ceil((totalRows ?? 0) / size))

  return [currentPage - 1, currentPage + 1].filter((candidate) => candidate >= 1 && candidate <= lastPage)
}

export function useListRangeCache(options: {
  fetchRange: (params: { offset: number; limit: number }) => Promise<ViewDataRange | undefined>
  applyRange: (range: ViewDataRange) => void
  maxRanges?: number
}) {
  const maxRanges = Math.max(1, options.maxRanges ?? LIST_RANGE_CACHE_LIMIT)
  const ranges = new Map<string, ViewDataRange>()
  const pending = new Map<string, Promise<void>>()
  const readyPages = ref<number[]>([])
  let generation = 0

  const rangeKey = (page: number, pageSize: number) => `${page}:${pageSize}`

  const syncReadyPages = () => {
    readyPages.value = Array.from(ranges.keys())
      .map((key) => Number(key.split(':')[0]))
      .filter((page) => Number.isInteger(page))
      .sort((a, b) => a - b)
  }

  const trim = () => {
    while (ranges.size > maxRanges) {
      const oldestKey = ranges.keys().next().value
      if (!oldestKey) break
      ranges.delete(oldestKey)
    }
    syncReadyPages()
  }

  const invalidate = () => {
    generation += 1
    ranges.clear()
    pending.clear()
    syncReadyPages()
  }

  const prefetchPage = async (page: number, pageSize: number) => {
    if (page < 1 || pageSize < 1) return

    const key = rangeKey(page, pageSize)
    if (ranges.has(key)) return
    if (pending.has(key)) return pending.get(key)

    const requestGeneration = generation
    const request = options
      .fetchRange({
        offset: (page - 1) * pageSize,
        limit: pageSize,
      })
      .then((range) => {
        if (!range || requestGeneration !== generation) return
        ranges.set(key, range)
        trim()
      })
      .catch(() => undefined)
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key)
      })

    pending.set(key, request)
    return request
  }

  const prefetchAdjacent = async (pagination: PaginatedType) => {
    const pageSize = pagination.pageSize ?? 25
    await Promise.all(getListAdjacentRangePages(pagination).map((page) => prefetchPage(page, pageSize)))
  }

  const applyPrefetchedPage = (page: number, pageSize: number) => {
    const key = rangeKey(page, pageSize)
    const range = ranges.get(key)
    if (!range) return false

    ranges.delete(key)
    ranges.set(key, range)
    options.applyRange(range)
    syncReadyPages()
    return true
  }

  return {
    readyPages,
    invalidate,
    prefetchPage,
    prefetchAdjacent,
    applyPrefetchedPage,
  }
}
