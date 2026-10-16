<template>
  <section class="pdf-preview" aria-label="合同 PDF 预览">
    <div class="pdf-toolbar">
      <el-button size="small" :disabled="page <= 1 || !pageCount" @click="changePage(page - 1)">上一页</el-button>
      <span>第 {{ page }} / {{ pageCount || '—' }} 页</span>
      <el-button size="small" :disabled="page >= pageCount" @click="changePage(page + 1)">下一页</el-button>
    </div>
    <p v-if="error" class="preview-error" role="alert">{{ error }}。仍可在风险卡中查看原文片段和页码。</p>
    <div ref="container" class="pdf-canvas-wrap" v-loading="loading">
      <canvas ref="canvas" :aria-label="`合同第 ${page} 页`" role="img"></canvas>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { CONTRACT_FILE_LIMITS } from '../utils/contractFile'

GlobalWorkerOptions.workerSrc = workerUrl
const props = defineProps<{ file: File; page: number }>()
const emit = defineEmits<{ 'update:page': [page: number] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const container = ref<HTMLElement | null>(null)
const pageCount = ref(0)
const loading = ref(false)
const error = ref('')
let document: PDFDocumentProxy | null = null
let loadingTask: PDFDocumentLoadingTask | null = null
let renderTask: RenderTask | null = null
let renderQueue: Promise<void> = Promise.resolve()
let loadVersion = 0
let renderVersion = 0
let resizeObserver: ResizeObserver | null = null

function changePage(page: number) { emit('update:page', Math.max(1, Math.min(pageCount.value, page))) }

function renderPage() {
  const version = ++renderVersion
  renderTask?.cancel()
  renderQueue = renderQueue.catch(() => {}).then(async () => {
    const currentDocument = document
    if (version !== renderVersion || !currentDocument || !canvas.value) return
    loading.value = true
    error.value = ''
    try {
      const page = await currentDocument.getPage(Math.max(1, Math.min(props.page, currentDocument.numPages)))
      if (version !== renderVersion || document !== currentDocument || !canvas.value) return
      const baseViewport = page.getViewport({ scale: 1 })
      const width = Math.max(180, (container.value?.clientWidth || 600) - 24)
      if (!Number.isFinite(baseViewport.width) || !Number.isFinite(baseViewport.height) || baseViewport.width <= 0 || baseViewport.height <= 0) throw new Error('Invalid page size')
      // 限制极端页面长宽与高 DPR 下的 canvas 分配，不把 PDF 内嵌脚本/链接挂入 DOM。
      const scale = Math.min(1.7, width / baseViewport.width, 1600 / baseViewport.height, 1600 / baseViewport.width)
      const viewport = page.getViewport({ scale })
      const outputScale = Math.min(window.devicePixelRatio || 1, 2)
      canvas.value.width = Math.floor(viewport.width * outputScale)
      canvas.value.height = Math.floor(viewport.height * outputScale)
      canvas.value.style.width = `${viewport.width}px`
      canvas.value.style.height = `${viewport.height}px`
      renderTask = page.render({ canvas: canvas.value, viewport, transform: [outputScale, 0, 0, outputScale, 0, 0] })
      await renderTask.promise
    } catch (cause) {
      if (version === renderVersion && (cause as Error).name !== 'RenderingCancelledException') error.value = '当前页无法预览'
    } finally { if (version === renderVersion) loading.value = false }
  })
}

watch(() => props.file, async file => {
  const version = ++loadVersion
  ++renderVersion
  renderTask?.cancel()
  document = null
  if (canvas.value) { canvas.value.width = 0; canvas.value.height = 0 }
  pageCount.value = 0
  error.value = ''
  loading.value = true
  await loadingTask?.destroy().catch(() => {})
  if (version !== loadVersion) return
  try {
    await nextTick()
    const data = new Uint8Array(await file.arrayBuffer())
    if (version !== loadVersion) return
    const baseUrl = import.meta.env.BASE_URL
    const currentTask = getDocument({ data, cMapUrl: `${baseUrl}pdfjs-assets/cmaps/`, cMapPacked: true, standardFontDataUrl: `${baseUrl}pdfjs-assets/standard_fonts/`, useWasm: false })
    loadingTask = currentTask
    const pdf = await currentTask.promise
    if (version !== loadVersion) { await currentTask.destroy(); return }
    if (pdf.numPages > CONTRACT_FILE_LIMITS.maxPages) { await currentTask.destroy(); throw new Error('Page limit') }
    document = pdf
    pageCount.value = pdf.numPages
    renderPage()
  } catch (cause) {
    if (version === loadVersion) {
      error.value = (cause as Error).name === 'PasswordException' ? '暂不支持加密 PDF' : '无法预览此 PDF'
      loading.value = false
    }
  }
}, { immediate: true })

watch(() => props.page, renderPage)
onMounted(() => {
  resizeObserver = new ResizeObserver(() => { if (document) renderPage() })
  if (container.value) resizeObserver.observe(container.value)
})
onBeforeUnmount(() => {
  ++loadVersion
  ++renderVersion
  resizeObserver?.disconnect()
  renderTask?.cancel()
  void loadingTask?.destroy().catch(() => {})
})
</script>

<style scoped>
.pdf-toolbar { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 12px; font-size: 14px; }
.pdf-canvas-wrap { min-height: 300px; padding: 12px; background: #e9edf2; overflow: auto; text-align: center; }
canvas { display: block; margin: 0 auto; background: white; }
.preview-error { color: #b54708; font-size: 13px; }
</style>
