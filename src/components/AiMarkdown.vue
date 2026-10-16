<template><div class="ai-markdown" v-html="html" /></template>
<script setup lang="ts">
import { computed } from 'vue'
import { renderSafeMarkdown } from '../utils/markdown'
const props = defineProps<{ content: string }>()
// 父页面先合并增量；此 computed 对未变化的已完成消息复用结果。
const html = computed(() => renderSafeMarkdown(props.content))
</script>
<style scoped>
.ai-markdown { line-height: 1.85; font-size: 14px; overflow-wrap: anywhere; min-width: 0; }
.ai-markdown :deep(p) { margin: .5em 0; }
.ai-markdown :deep(h1), .ai-markdown :deep(h2), .ai-markdown :deep(h3) { font-size: 1.12em; line-height: 1.5; margin: 1em 0 .5em; }
.ai-markdown :deep(ul), .ai-markdown :deep(ol) { padding-left: 1.5em; }
.ai-markdown :deep(pre) { background: #eef2f6; border-radius: 8px; padding: 14px; overflow-x: auto; white-space: pre; max-width: 100%; }
.ai-markdown :deep(code) { font-family: Consolas, monospace; background: #eef2f6; border-radius: 4px; padding: 2px 4px; }
.ai-markdown :deep(pre code) { padding: 0; }
.ai-markdown :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; max-width: 100%; }
.ai-markdown :deep(th), .ai-markdown :deep(td) { padding: 7px 10px; border: 1px solid #dce3eb; min-width: 70px; }
.ai-markdown :deep(blockquote) { border-left: 3px solid #8fb6cf; margin: 12px 0; padding: 2px 14px; color: #546777; }
.ai-markdown :deep(a) { color: #247d8d; text-decoration: underline; }
</style>
