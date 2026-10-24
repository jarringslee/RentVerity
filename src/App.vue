<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import userStore from './stores/userStore'

const route = useRoute(), router = useRouter()
const refresh = () => userStore.refreshSession()
const timer = setInterval(() => { if (userStore.isLoggedIn()) void refresh() }, 30000)
window.addEventListener('focus', refresh)
watch(() => [userStore.initialized.value, userStore.currentUser.value?.sessionId], () => {
  if (userStore.initialized.value && !userStore.isLoggedIn() && route.meta.requiresAuth) void router.replace({ path: '/login', query: { redirect: route.fullPath } })
})
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('focus', refresh) })
</script>

<template>
  <el-alert v-if="userStore.sessionExpired.value" class="session-alert" type="warning" :closable="false" show-icon title="登录已过期，请重新登录。">
    <router-link :to="{ path: '/login', query: { redirect: route.path === '/login' ? route.query.redirect : route.fullPath } }">前往登录</router-link>
  </el-alert>
  <el-alert v-if="userStore.sessionError.value" class="session-alert" type="warning" :closable="false" :title="userStore.sessionError.value">
    <el-button link @click="refresh">重新检查登录状态</el-button>
  </el-alert>
  <div v-if="!userStore.initialized.value" class="session-loading">正在恢复登录状态…</div>
  <router-view v-else :key="`${userStore.sessionVersion.value}:${userStore.currentUser.value?.id ?? 'guest'}`" />
</template>

<style>
.session-alert { position: sticky; top: 0; z-index: 2100; box-sizing: border-box; }
.session-loading { padding: 48px; text-align: center; color: #666; }
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
