<script setup lang="ts">
// 根组件
</script>

<template>
  <div id="app">
    <router-view />
  </div>
</template>

<style>
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
