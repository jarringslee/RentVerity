<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import userStore from './stores/userStore'

const route = useRoute(), router = useRouter()
const refresh = () => userStore.refreshSession()
const timer = setInterval(refresh, 30000)
window.addEventListener('focus', refresh)
watch(() => userStore.currentUser.value?.token, token => {
  if (!token && route.meta.requiresAuth) void router.replace({ path: '/login', query: { redirect: route.fullPath } })
})
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('focus', refresh) })
</script>

<template>
  <el-alert v-if="userStore.sessionExpired.value" class="session-alert" type="warning" :closable="false" show-icon title="登录已过期，请重新登录。">
    <router-link :to="{ path: '/login', query: { redirect: route.path === '/login' ? route.query.redirect : route.fullPath } }">前往登录</router-link>
  </el-alert>
  <router-view :key="userStore.currentUser.value?.id ?? 'guest'" />
</template>

<style>
.session-alert { position: sticky; top: 0; z-index: 2100; box-sizing: border-box; }
html, body {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
}

#app {
  height: 100vh;
  overflow-y: auto;
}
</style>
