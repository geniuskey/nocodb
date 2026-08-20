<script setup lang="ts">
import { UITypes, ViewTypes } from 'nocodb-sdk'
import type { ColumnType, ListType } from 'nocodb-sdk'
import { resolveListPresentationFields } from '~/utils/listView'

const activeView = inject(ActiveViewInj, ref())
const fields = inject(FieldsInj, ref<ColumnType[]>([]))
const isLocked = inject(IsLockedInj, ref(false))

const { updateViewMeta } = useViewsStore()
const { addUndo, defineViewScope } = useUndoRedo()

const open = ref(false)
const isSaving = ref(false)
const noFieldValue = '__none__'

const listConfig = computed<Partial<ListType>>(() => (activeView.value?.view as ListType) || {})
const presentation = computed(() => resolveListPresentationFields(fields.value, listConfig.value))

const fieldOptions = computed(() => fields.value.filter((field) => field.id))
const attachmentOptions = computed(() => fieldOptions.value.filter((field) => field.uidt === UITypes.Attachment))
const colorFieldOptions = computed(() => fieldOptions.value.filter((field) => field.uidt === UITypes.SingleSelect))
const listMeta = computed<Record<string, unknown>>(() => parseProp(listConfig.value.meta))

const saveSettings = async (updates: Record<string, unknown>, undo = false) => {
  if (!activeView.value?.id || isLocked.value || isSaving.value) return

  const previous = Object.keys(updates).reduce<Record<string, unknown>>((values, key) => {
    values[key] = (listConfig.value as Record<string, unknown>)[key]
    return values
  }, {})

  if (!undo) {
    addUndo({
      undo: {
        fn: saveSettings,
        args: [previous, true],
      },
      redo: {
        fn: saveSettings,
        args: [updates, true],
      },
      scope: defineViewScope({ view: activeView.value }),
    })
  }

  isSaving.value = true
  try {
    await updateViewMeta(activeView.value.id, ViewTypes.LIST, updates)
  } catch (error: any) {
    message.error((await extractSdkResponseErrorMsg(error)) || 'There was an error while updating the List view.')
  } finally {
    isSaving.value = false
  }
}

const titleColumnId = computed(() => listConfig.value.fk_title_column_id || presentation.value.titleField?.id)
const subtitleColumnId = computed(() =>
  listConfig.value.fk_subtitle_column_id === ''
    ? noFieldValue
    : listConfig.value.fk_subtitle_column_id || presentation.value.subtitleField?.id || noFieldValue,
)
const imageColumnId = computed(() => listConfig.value.fk_image_column_id || noFieldValue)
const colorByFieldId = computed(() => listMeta.value.color_by_field_id || noFieldValue)
const density = computed(() => listConfig.value.density || 'comfortable')
const showFieldLabels = computed(() => ![false, 0, '0'].includes(listConfig.value.show_field_labels))

const updateTitle = (columnId: string) => {
  const updates: Record<string, unknown> = { fk_title_column_id: columnId }
  if (columnId === subtitleColumnId.value) updates.fk_subtitle_column_id = ''
  return saveSettings(updates)
}

useMenuCloseOnEsc(open)
</script>

<template>
  <NcDropdown v-model:visible="open" :trigger="['click']" offset-y overlay-class-name="nc-list-settings-dropdown">
    <NcTooltip :disabled="open">
      <template #title>{{ $t('general.appearance') }}</template>
      <NcButton
        data-testid="nc-list-settings-button"
        class="nc-toolbar-btn !h-7 !border-0 !px-1.5"
        type="secondary"
        size="small"
        :show-as-disabled="isLocked"
      >
        <div class="flex items-center gap-1">
          <GeneralIcon icon="settings" class="h-4 w-4" />
          <span class="text-small1 font-medium">{{ $t('general.appearance') }}</span>
        </div>
      </NcButton>
    </NcTooltip>

    <template #overlay>
      <div data-testid="nc-list-settings" class="w-80 rounded-lg bg-nc-bg-default p-3" @click.stop>
        <div class="mb-3 text-sm font-semibold text-nc-content-gray-emphasis">
          {{ $t('labels.listViewAppearance') }}
        </div>

        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1 text-xs text-nc-content-gray-muted">
            {{ $t('labels.listTitleField') }}
            <a-select
              :value="titleColumnId"
              data-testid="nc-list-title-field"
              :disabled="isLocked || isSaving"
              @change="updateTitle"
            >
              <a-select-option v-for="field in fieldOptions" :key="field.id" :value="field.id">
                <div class="flex items-center gap-2">
                  <SmartsheetHeaderIcon :column="field" class="!h-3.5 !w-3.5" />
                  <span class="truncate">{{ field.title }}</span>
                </div>
              </a-select-option>
            </a-select>
          </label>

          <label class="flex flex-col gap-1 text-xs text-nc-content-gray-muted">
            {{ $t('labels.listSubtitleField') }}
            <a-select
              :value="subtitleColumnId"
              data-testid="nc-list-subtitle-field"
              :disabled="isLocked || isSaving"
              @change="(value) => saveSettings({ fk_subtitle_column_id: value === noFieldValue ? '' : value })"
            >
              <a-select-option :value="noFieldValue">{{ $t('general.none') }}</a-select-option>
              <a-select-option
                v-for="field in fieldOptions.filter((option) => option.id !== titleColumnId)"
                :key="field.id"
                :value="field.id"
              >
                <div class="flex items-center gap-2">
                  <SmartsheetHeaderIcon :column="field" class="!h-3.5 !w-3.5" />
                  <span class="truncate">{{ field.title }}</span>
                </div>
              </a-select-option>
            </a-select>
          </label>

          <label class="flex flex-col gap-1 text-xs text-nc-content-gray-muted">
            {{ $t('labels.listImageField') }}
            <a-select
              :value="imageColumnId"
              data-testid="nc-list-image-field"
              :disabled="isLocked || isSaving"
              @change="(value) => saveSettings({ fk_image_column_id: value === noFieldValue ? '' : value })"
            >
              <a-select-option :value="noFieldValue">{{ $t('general.none') }}</a-select-option>
              <a-select-option v-for="field in attachmentOptions" :key="field.id" :value="field.id">
                <div class="flex items-center gap-2">
                  <SmartsheetHeaderIcon :column="field" class="!h-3.5 !w-3.5" />
                  <span class="truncate">{{ field.title }}</span>
                </div>
              </a-select-option>
            </a-select>
          </label>

          <label class="flex flex-col gap-1 text-xs text-nc-content-gray-muted">
            {{ $t('labels.listColorByField') }}
            <a-select
              :value="colorByFieldId"
              data-testid="nc-list-color-field"
              :disabled="isLocked || isSaving"
              @change="
                (value) =>
                  saveSettings({
                    meta: { ...listMeta, color_by_field_id: value === noFieldValue ? '' : value },
                  })
              "
            >
              <a-select-option :value="noFieldValue">{{ $t('general.none') }}</a-select-option>
              <a-select-option v-for="field in colorFieldOptions" :key="field.id" :value="field.id">
                <div class="flex items-center gap-2">
                  <SmartsheetHeaderIcon :column="field" class="!h-3.5 !w-3.5" />
                  <span class="truncate">{{ field.title }}</span>
                </div>
              </a-select-option>
            </a-select>
          </label>

          <div class="flex flex-col gap-1 text-xs text-nc-content-gray-muted">
            {{ $t('labels.listDensity') }}
            <div class="grid grid-cols-3 gap-1 rounded-lg bg-nc-bg-gray-light p-1">
              <button
                v-for="option in ['compact', 'comfortable', 'spacious']"
                :key="option"
                :data-testid="`nc-list-density-${option}`"
                class="rounded-md px-2 py-1.5 text-xs capitalize transition-colors"
                :class="
                  density === option
                    ? 'bg-nc-bg-default text-nc-content-brand shadow-sm'
                    : 'text-nc-content-gray-muted hover:bg-nc-bg-gray-medium'
                "
                :disabled="isLocked || isSaving"
                @click="saveSettings({ density: option })"
              >
                {{ $t(`labels.listDensity${option[0].toUpperCase()}${option.slice(1)}`) }}
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between text-sm text-nc-content-gray-subtle2">
            <span>{{ $t('labels.listShowFieldLabels') }}</span>
            <NcSwitch
              :checked="showFieldLabels"
              data-testid="nc-list-show-field-labels"
              size="small"
              :disabled="isLocked || isSaving"
              @update:checked="(value) => saveSettings({ show_field_labels: value })"
            />
          </div>
        </div>

        <GeneralLockedViewFooter v-if="isLocked" class="-mx-3 -mb-3 mt-3" @on-open="open = false" />
      </div>
    </template>
  </NcDropdown>
</template>
