<template>
  <section class="pdf-preview" aria-label="合同 PDF 预览">
    <p v-if="!previewEnabled" class="preview-note">文件尚未进行本地解析。预览为独立操作，可能占用内存；大文件建议先分析，需要核对时再按需打开。</p>
    <el-button v-if="!previewEnabled" @click="previewEnabled = true">打开本地预览</el-button>
    <el-button v-else size="small" @click="previewEnabled = false">关闭预览并释放资源</el-button>
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
import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl
const props = defineProps<{ file: File; page: number }>()
const emit = defineEmits<{ 'update:page': [page: number] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const container = ref<HTMLElement | null>(null)
const pageCount = ref(0)
const loading = ref(false)
const error = ref('')
const previewEnabled = ref(false)
defineExpose({ open: () => { previewEnabled.value = true } })

class LocalFileRange extends PDFDataRangeTransport {
  private stopped = false
  constructor(private file: File, first: Uint8Array) { super(file.size, first, false) }
  override requestDataRange(begin: number, end: number) {
    void this.file.slice(begin, end).arrayBuffer().then(data => { if (!this.stopped) this.onDataRange(begin, new Uint8Array(data)) }).catch(() => this.abort())
  }
  override abort() { this.stopped = true }
}
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

watch(() => [props.file, previewEnabled.value] as const, async ([file, enabled]) => {
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
  if (!enabled) { loadingTask = null; loading.value = false; return }
  try {
    await nextTick()
    const first = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
    if (version !== loadVersion) return
    const baseUrl = import.meta.env.BASE_URL
    const currentTask = getDocument({ range: new LocalFileRange(file, first), rangeChunkSize: 65536, disableAutoFetch: true, disableStream: true, enableXfa: false, cMapUrl: `${baseUrl}pdfjs-assets/cmaps/`, cMapPacked: true, standardFontDataUrl: `${baseUrl}pdfjs-assets/standard_fonts/`, useWasm: false })
    loadingTask = currentTask
    const pdf = await currentTask.promise
    if (version !== loadVersion) { await currentTask.destroy(); return }
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

watch(() => props.page, () => { if (!previewEnabled.value) previewEnabled.value = true; else renderPage() })
watch(() => props.file, () => { previewEnabled.value = false })
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
