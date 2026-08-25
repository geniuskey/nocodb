<script setup lang="ts">
const { $e } = useNuxtApp()

const { isDark } = useTheme()

const socialIcons = [
  {
    name: 'RowWeave on GitHub',
    icon: iconMap.github,
    e: 'c:rowweave:github-open',
    link: 'https://github.com/geniuskey/rowweave',
  },
]

const openUrl = (url: string, e: string) => {
  $e(e, {
    trigger: 'feed',
  })
  window.open(url, '_blank')
}
</script>

<template>
  <div style="width: 230px" class="flex flex-col bg-nc-bg-default border-nc-border-gray-medium rounded-lg border-1">
    <div class="text-nc-content-gray font-semibold leading-6 border-b-1 border-nc-border-gray-medium px-4 py-3">Stay tuned</div>
    <div class="flex flex-col p-1">
      <div
        v-for="social in socialIcons"
        :key="social.name"
        class="flex items-center social-icon-wrapper cursor-pointer rounded-lg hover:bg-nc-bg-gray-light py-3 px-4 gap-2 text-nc-content-gray"
        @click="openUrl(social.link, social.e)"
      >
        <component
          :is="social.icon"
          :class="{
            'dark-mode': isDark,
          }"
          class="w-5 h-5 stroke-transparent social-icon"
        />
        <span class="font-semibold">{{ social.name }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.social-icon:not(.dark-mode) {
  // Make icon black and white
  filter: grayscale(100%);

  // Make icon color on hover
  &:hover {
    filter: grayscale(100%) invert(100%);
  }
}

.social-icon-wrapper {
  .nc-icon {
    @apply mr-0.15;
  }

  &:hover {
    .social-icon {
      filter: none !important;
    }
  }
}
</style>
