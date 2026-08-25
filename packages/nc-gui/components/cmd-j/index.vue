<script setup lang="ts">
import { useVModel } from '@vueuse/core'

const props = defineProps<{
  open: boolean
  setActiveCmdView: (cmd: CommandPaletteType) => void
}>()

const emits = defineEmits(['update:open'])
const vOpen = useVModel(props, 'open', emits)
const { user } = useGlobal()

const modalEl = ref<HTMLElement | null>(null)
const cmdInputEl = ref<HTMLInputElement | null>(null)
const search = ref('')
const selectedIndex = ref(0)

const documents = [
  { title: 'Building RowWeave', url: 'docs/BUILDING.md' },
  { title: 'Architecture', url: 'docs/ARCHITECTURE.md' },
  { title: 'Compatibility contract', url: 'docs/COMPATIBILITY.md' },
  { title: 'Feature matrix and roadmap', url: 'docs/FEATURE_MATRIX.md' },
  { title: 'AGPL baseline audit', url: 'docs/BASELINE_AUDIT.md' },
  { title: 'Branding', url: 'docs/BRANDING.md' },
]

const results = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  if (!term) return documents
  return documents.filter((document) => document.title.toLocaleLowerCase().includes(term))
})

const hide = () => {
  vOpen.value = false
  search.value = ''
  selectedIndex.value = 0
}

const openDocument = (url: string) => {
  window.open(`https://github.com/geniuskey/rowweave/blob/foundation/${url}`, '_blank', 'noopener,noreferrer')
  hide()
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (!vOpen.value) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, results.value.length - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (event.key === 'Enter' && results.value[selectedIndex.value]) {
    event.preventDefault()
    openDocument(results.value[selectedIndex.value].url)
  }
}

onClickOutside(modalEl, hide)

useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    hide()
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
    if (vOpen.value || !user.value?.id) {
      hide()
      return
    }

    vOpen.value = true
    nextTick(() => cmdInputEl.value?.focus())
  } else {
    handleKeyDown(event)
  }
})

watch(vOpen, (open) => {
  if (open) nextTick(() => cmdInputEl.value?.focus())
  else selectedIndex.value = 0
})

watch(results, () => {
  selectedIndex.value = 0
})
</script>

<template>
  <div v-if="vOpen" class="fixed inset-0 z-1100 bg-white/50 flex items-start justify-center pt-[12vh]">
    <div ref="modalEl" class="w-[min(42rem,calc(100vw-2rem))] bg-white rounded-xl shadow-xl border-1 border-gray-200 overflow-hidden">
      <div class="flex items-center gap-3 px-4 border-b-1 border-gray-200">
        <GeneralIcon class="h-4 w-4 text-gray-500" icon="search" />
        <input
          ref="cmdInputEl"
          v-model="search"
          class="w-full py-4 outline-none"
          placeholder="Search RowWeave documentation"
          type="text"
        />
      </div>

      <div class="max-h-80 overflow-y-auto p-2">
        <button
          v-for="(document, index) in results"
          :key="document.url"
          type="button"
          class="w-full flex items-center gap-3 text-left rounded-lg px-3 py-3 hover:bg-gray-100"
          :class="{ 'bg-gray-100': selectedIndex === index }"
          @click="openDocument(document.url)"
          @mouseenter="selectedIndex = index"
        >
          <GeneralIcon icon="file" class="h-4 w-4 flex-none" />
          <span>{{ document.title }}</span>
        </button>

        <div v-if="results.length === 0" class="p-6 text-center text-gray-500">No matching RowWeave document</div>
      </div>

      <CmdFooter active-cmd="cmd-j" :set-active-cmd-view="setActiveCmdView" />
    </div>
  </div>
</template>
