import { describe, expect, it, vi } from 'vitest'
import type { ViewDataRange } from '../../composables/useViewData'
import { getListAdjacentRangePages, useListRangeCache } from '../../composables/useListRangeCache'

const rangeForPage = (page: number, pageSize = 25, totalRows = 100): ViewDataRange =>
  ({
    rows: [{ row: { Id: page }, oldRow: { Id: page }, rowMeta: {} }],
    pageInfo: { page, pageSize, totalRows },
  } as ViewDataRange)

describe('List server range cache', () => {
  it('selects only valid adjacent ranges', () => {
    expect(getListAdjacentRangePages({ page: 1, pageSize: 25, totalRows: 100 })).toEqual([2])
    expect(getListAdjacentRangePages({ page: 2, pageSize: 25, totalRows: 100 })).toEqual([1, 3])
    expect(getListAdjacentRangePages({ page: 4, pageSize: 25, totalRows: 100 })).toEqual([3])
    expect(getListAdjacentRangePages({ page: 1, pageSize: 25, totalRows: 0 })).toEqual([])
  })

  it('fetches an adjacent offset once and applies the cached range', async () => {
    const fetchRange = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) =>
      rangeForPage(offset / limit + 1, limit),
    )
    const applyRange = vi.fn()
    const cache = useListRangeCache({ fetchRange, applyRange })

    await cache.prefetchAdjacent({ page: 1, pageSize: 25, totalRows: 100 })
    await cache.prefetchAdjacent({ page: 1, pageSize: 25, totalRows: 100 })

    expect(fetchRange).toHaveBeenCalledTimes(1)
    expect(fetchRange).toHaveBeenCalledWith({ offset: 25, limit: 25 })
    expect(cache.readyPages.value).toEqual([2])
    expect(cache.applyPrefetchedPage(2, 25)).toBe(true)
    expect(applyRange).toHaveBeenCalledWith(rangeForPage(2))
  })

  it('keeps a bounded least-recently-used set of ranges', async () => {
    const cache = useListRangeCache({
      fetchRange: async ({ offset, limit }) => rangeForPage(offset / limit + 1, limit),
      applyRange: vi.fn(),
    })

    await cache.prefetchPage(1, 25)
    await cache.prefetchPage(2, 25)
    await cache.prefetchPage(3, 25)
    expect(cache.applyPrefetchedPage(1, 25)).toBe(true)
    await cache.prefetchPage(4, 25)

    expect(cache.readyPages.value).toEqual([1, 3, 4])
    expect(cache.applyPrefetchedPage(2, 25)).toBe(false)
  })

  it('ignores an in-flight response after invalidation', async () => {
    let resolveRange: ((range: ViewDataRange) => void) | undefined
    const pendingRange = new Promise<ViewDataRange>((resolve) => {
      resolveRange = resolve
    })
    const cache = useListRangeCache({
      fetchRange: () => pendingRange,
      applyRange: vi.fn(),
    })

    const prefetch = cache.prefetchPage(2, 25)
    cache.invalidate()
    resolveRange?.(rangeForPage(2))
    await prefetch

    expect(cache.readyPages.value).toEqual([])
    expect(cache.applyPrefetchedPage(2, 25)).toBe(false)
  })
})
