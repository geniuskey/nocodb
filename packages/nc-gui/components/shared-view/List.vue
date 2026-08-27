<script lang="ts" setup>
const { sharedView, meta, nestedFilters } = useSharedView()

const { signedIn } = useGlobal()
const { loadProject } = useBase()
const { isLocked, xWhere } = useProvideSmartsheetStore(sharedView, meta, true, ref([]), nestedFilters)

const reloadEventHook = createEventHook()

provide(ReloadViewDataHookInj, reloadEventHook)
provide(ReadonlyInj, ref(true))
provide(MetaInj, meta)
provide(ActiveViewInj, sharedView)
provide(IsPublicInj, ref(true))
provide(IsLockedInj, isLocked)
provide(ReloadAggregateHookInj, createEventHook())

useProvideViewColumns(sharedView, meta, () => reloadEventHook.trigger(), true)
useProvideViewGroupBy(sharedView, meta, xWhere, true)
useProvideSmartsheetLtarHelpers(meta)
useViewRowColorProvider({ shared: true })

if (signedIn.value) {
  try {
    await loadProject()
  } catch (e: any) {
    console.error(e)
    message.error(await extractSdkResponseErrorMsg(e))
  }
}
</script>

<template>
  <div class="nc-container flex h-full flex-col">
    <LazySmartsheetToolbar show-full-screen-toggle />
    <LazySmartsheetList />
  </div>
</template>

<style scoped>
.nc-container {
  flex: 1 1 100%;
}
</style>
