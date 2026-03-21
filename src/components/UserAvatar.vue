<template>
  <img
    class="user-avatar"
    :src="displaySrc"
    alt=""
    :width="size"
    :height="size"
    @error="onImgError"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { resolveAvatarSrc, DEFAULT_AVATAR_PATH } from '../utils/avatarUrl'

const props = withDefaults(
  defineProps<{
    avatarUrl?: string | null
    size?: number
  }>(),
  { size: 40 }
)

const busted = ref(false)

watch(
  () => props.avatarUrl,
  () => {
    busted.value = false
  }
)

const displaySrc = computed(() => {
  if (busted.value) return DEFAULT_AVATAR_PATH
  return resolveAvatarSrc(props.avatarUrl)
})

function onImgError() {
  busted.value = true
}
</script>

<style scoped>
.user-avatar {
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  display: block;
  vertical-align: middle;
}
</style>
