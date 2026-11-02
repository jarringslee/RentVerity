<template>
  <div class="contract-page">
    <header class="contract-header">
      <div><span class="eyebrow">RENTVERITY · 合同助手</span><h1>合同风险分析</h1><p>从条款出发，逐条核对 AI 提示。分析仅供参考，不替代专业法律意见。</p></div>
      <div class="header-actions"><el-button @click="router.push('/ai-assistant')">AI 找房</el-button><el-button @click="router.push('/')">首页</el-button><HeaderUserMenu v-if="isLoggedIn" /></div>
    </header>
    <main class="contract-main">
      <el-alert v-if="!isLoggedIn" title="请先登录，再上传合同进行分析。" type="info" :closable="false" show-icon>
        <el-button type="primary" @click="router.push({ path: '/login', query: { redirect: '/contract-analysis' } })">前往登录</el-button>
      </el-alert>
      <el-card class="upload-card">
        <div class="upload-heading"><h2>选择一份文字型 PDF</h2><el-tag type="info">≤{{ Math.floor(limits.maxBytes / 1024 / 1024) }} MiB · ≤{{ limits.maxPages }} 页</el-tag></div>
        <p class="muted">提取文本最多 {{ limits.maxCharacters }} 字符、{{ limits.maxChunks }} 块，最终最多展示20条有原文依据的提示。暂不支持扫描件、加密 PDF、DOC/DOCX。</p>
        <div class="drop-zone" :class="{ dragging, disabled: busy || !isLoggedIn, 'has-file': file }"
          @dragenter.prevent="onDragEnter" @dragover.prevent @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
          <span class="file-badge" aria-hidden="true">PDF</span>
          <div class="drop-copy"><strong>{{ file ? file.name : '将合同拖到这里，或点击选择' }}</strong>
            <p>{{ file ? '拖入新文件或点击替换；替换后需重新确认授权。' : '仅上传你有权处理、已移除敏感信息的合同。' }}</p>
          </div>
          <el-button :disabled="busy || selecting || !isLoggedIn" :loading="selecting" @click="fileInput?.click()">{{ file ? '替换文件' : '选择 PDF' }}</el-button>
          <input id="contract-file" ref="fileInput" class="file-input" aria-label="选择合同 PDF" type="file" accept="application/pdf,.pdf" :disabled="busy || selecting || !isLoggedIn" @change="selectFile" />
        </div>
        <div v-if="file" class="file-summary">{{ (file.size / 1024 / 1024).toFixed(2) }} MB <span v-if="parsed"> · 已提取 {{ parsed.pageCount }} 页 / {{ parsed.characterCount }} 字符</span><span v-else> · 尚未上传</span></div>
        <ol class="process-steps" aria-label="合同处理步骤"><li v-for="(step, index) in steps" :key="step.label" :class="step.state" :aria-current="step.state === 'active' ? 'step' : undefined"><span>{{ step.state === 'done' ? '✓' : index + 1 }}</span>{{ step.label }}</li></ol>
        <el-checkbox v-model="consent" :disabled="busy || !isLoggedIn" class="consent">我确认可使用该文件，并同意将提取文本发送至 DeepSeek 分析；请先移除个人敏感信息。</el-checkbox>
        <div class="upload-actions">
          <el-button type="primary" :disabled="!file || !consent || !isLoggedIn || stage === 'done' || selecting" :loading="busy" @click="startAnalysis">{{ buttonText }}</el-button>
          <el-button v-if="busy" @click="cancelAnalysis">停止本次请求</el-button>
          <el-button v-else :disabled="!file" @click="clearFile">清除文件</el-button>
          <span class="stage-text" role="status" aria-live="polite">{{ selecting ? '正在检查文件…' : stageText }}</span>
        </div>
        <el-alert v-if="selectionError || errorMessage" :title="selectionError || errorMessage" type="error" :closable="false" show-icon class="status-alert" />
        <p v-if="task?.chunks.length" class="block-progress" role="status">已核验 {{ doneBlocks }}/{{ task.chunks.length }} 块 · 未完成/失败 {{ failedBlocks }} 块 · 模型调用 {{ task.stats.modelCalls }} 次 · 重试 {{ task.stats.retries }} 次</p>
        <p class="privacy-note">选择文件只做本地文件头校验；点击开始分析才上传，预览需单独打开。原文件流式写入私有临时目录，由独立进程解析；按需回收，TTL与定期清扫兜底，无合同历史。任务最长约{{ Math.ceil(limits.taskTimeoutMs / 60000) }}分钟，部分失败不代表全文成功。刷新需重新选文件；停止不保证模型未计费。隔离与限制不是病毒查杀或完整安全沙箱。</p>
      </el-card>

      <div v-if="file" class="review-grid">
        <section ref="previewPanel" class="preview-panel">
          <el-card><template #header><h2>合同原文</h2></template>
            <ContractPdfPreview ref="pdfPreview" :file="file" v-model:page="currentPage" />
            <blockquote v-if="activeFinding" class="active-quote"><strong>第 {{ activeFinding.page }} 页引用</strong><p>{{ activeFinding.quote }}</p></blockquote>
          </el-card>
        </section>
        <section class="result-panel" aria-label="合同分析结果">
          <el-card v-if="!result" class="result-placeholder">
            <span class="eyebrow">原文可追溯 · 结论需核实</span><h2>{{ busy ? stageText : stage === 'stopped' ? '本次请求已停止' : '分析结果将在这里展示' }}</h2>
            <p>每条风险提示都需要包含原文、所在页码、原因和建议。点击结果可切换到对应合同页。</p>
            <p v-if="busy">模型可能需要一段时间，当前没有使用模拟分析结果。</p>
          </el-card>
          <template v-else>
            <el-card class="summary-card">
              <h2>{{ stage === 'done' ? '合同分块核验结果' : '部分结果 · 非全文分析成功' }}</h2><p class="summary-text">{{ result.summary }}</p>
              <div class="risk-counts"><el-tag type="danger">高 {{ counts.high }}</el-tag><el-tag type="warning">中 {{ counts.medium }}</el-tag><el-tag type="info">低 {{ counts.low }}</el-tag><span>已核对引用 {{ result.findings.length }} 项</span></div>
              <p v-for="warning in result.warnings" :key="warning" class="result-warning">{{ warning }}</p>
            </el-card>
            <el-empty v-if="result.findings.length === 0" description="本次没有可展示的已核对提示，不代表合同无风险。" />
            <el-card v-for="finding in result.findings" :key="finding.id" class="finding-card" :class="{ selected: activeFinding?.id === finding.id }">
              <div class="finding-heading"><h3>{{ finding.category }}</h3><el-tag :type="finding.severity === 'high' ? 'danger' : finding.severity === 'medium' ? 'warning' : 'info'">{{ severityNames[finding.severity] }}风险提示</el-tag></div>
              <blockquote>{{ finding.quote }}</blockquote>
              <p><strong>需要核对：</strong>{{ finding.reason }}</p><p><strong>建议：</strong>{{ finding.suggestion }}</p>
              <el-button size="small" @click="locateFinding(finding)">查看第 {{ finding.page }} 页原文</el-button>
            </el-card>
          </template>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'
import ContractPdfPreview from '../components/ContractPdfPreview.vue'
import userStore from '../stores/userStore'
import { ContractApiError, discardContract, getContractLimits, getContractTask, retryContractTask, uploadContractTask } from '../services/contracts'
import type { ContractAnalysis, ContractFinding, ContractTask, ContractLimits } from '../types/contracts'
import { CONTRACT_FILE_LIMITS, validateContractSelection } from '../utils/contractFile'

const router = useRouter()
const isLoggedIn = computed(() => userStore.isLoggedIn())
const file = shallowRef<File | null>(null), fileInput = ref<HTMLInputElement | null>(null)
const previewPanel = ref<HTMLElement | null>(null), pdfPreview = ref<{ open: () => void } | null>(null)
const consent = ref(false), task = ref<ContractTask | null>(null), taskId = ref<string | null>(null)
const limits = ref<ContractLimits>({ ...CONTRACT_FILE_LIMITS, maxChunks: 64, maxFindings: 20, uploadTimeoutMs: 180000, taskTimeoutMs: 720000, ttlMs: 900000 })
const result = ref<ContractAnalysis | null>(null), activeFinding = ref<ContractFinding | null>(null)
const currentPage = ref(1)
const stage = ref<'idle' | 'uploading' | 'parsing' | 'analyzing' | 'partial' | 'done' | 'error' | 'stopped'>('idle')
const errorMessage = ref(''), selectionError = ref(''), selecting = ref(false), dragging = ref(false)
let dragDepth = 0, selectionVersion = 0, runVersion = 0, documentOwner: number | null = null
let controller: AbortController | null = null
const busy = computed(() => ['uploading', 'parsing', 'analyzing'].includes(stage.value))
const parsed = computed(() => task.value && task.value.pageCount > 0 ? task.value : null)
const doneBlocks = computed(() => task.value?.chunks.filter(c => c.state === 'succeeded').length ?? 0)
const failedBlocks = computed(() => task.value?.chunks.filter(c => c.state === 'failed').length ?? 0)
const canRetryBlocks = computed(() => !!task.value?.chunks.length && ['partial', 'failed'].includes(task.value.state) && task.value.stats.manualRetries < 1)
const stageText = computed(() => ({
  idle: file.value ? '文件仅在本地，确认后开始上传' : '待选择文件',
  uploading: '正在流式上传并核对接收完整性…',
  parsing: '已完整接收，正在隔离进程中解析…',
  analyzing: '正在分块分析并逐块核验原文…',
  partial: '仅部分分块完成，不能视为全文分析成功',
  done: '全部分块已完成，请逐条核实提示',
  error: '任务未完整完成，请查看提示',
  stopped: '已停止并请求回收服务器临时资源'
})[stage.value])
const steps = computed(() => [
  { label: '选择合同', state: file.value ? 'done' : 'active' },
  { label: '接收与隔离解析', state: parsed.value ? 'done' : ['uploading', 'parsing'].includes(stage.value) ? 'active' : 'waiting' },
  { label: '分块分析与核验', state: stage.value === 'done' ? 'done' : stage.value === 'analyzing' ? 'active' : 'waiting' },
  { label: '核对原文', state: result.value ? 'active' : 'waiting' }
])
const severityNames = { high: '高', medium: '中', low: '低' }
const counts = computed(() => (result.value?.findings ?? []).reduce((all, finding) => { all[finding.severity]++; return all }, { high: 0, medium: 0, low: 0 }))
const buttonText = computed(() => canRetryBlocks.value ? '只重试未完成块' : taskId.value && stage.value === 'error' ? '继续查看任务' : ['error', 'stopped'].includes(stage.value) ? '重新上传分析' : '开始分析')

function releaseSession() {
  const id = taskId.value
  if (id && documentOwner === userStore.getSessionVersion() && userStore.isLoggedIn()) void discardContract(id).catch(() => {})
  taskId.value = null; task.value = null; documentOwner = null
}
function cancelAnalysis() {
  ++runVersion; controller?.abort(); controller = null
  releaseSession(); selectionError.value = ''; stage.value = 'stopped'
}
function clearFile() {
  ++selectionVersion; selecting.value = false; cancelAnalysis()
  file.value = null; result.value = null; activeFinding.value = null; currentPage.value = 1
  errorMessage.value = ''; consent.value = false; selectionError.value = ''; stage.value = 'idle'; dragging.value = false; dragDepth = 0
  if (fileInput.value) fileInput.value.value = ''
}
async function selectCandidates(files: File[]) {
  if (!isLoggedIn.value || busy.value) { selectionError.value = busy.value ? '请先停止任务，再替换文件。' : '请先登录。'; return }
  const version = ++selectionVersion; selecting.value = true; selectionError.value = ''
  try {
    const candidate = await validateContractSelection(files)
    if (version !== selectionVersion) return
    clearFile(); file.value = candidate
  } catch (error) { if (version === selectionVersion) selectionError.value = error instanceof Error ? error.message : '无法读取文件。' }
  finally { if (version === selectionVersion) selecting.value = false }
}
function selectFile(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? [])
  input.value = ''; if (files.length) void selectCandidates(files)
}
function onDragEnter(event: DragEvent) { if (event.dataTransfer?.types.includes('Files')) { dragDepth++; if (!busy.value && isLoggedIn.value) dragging.value = true } }
function onDragLeave() { if (--dragDepth <= 0) { dragDepth = 0; dragging.value = false } }
function onDrop(event: DragEvent) {
  dragDepth = 0; dragging.value = false
  const transfer = event.dataTransfer
  if (!transfer) return
  if (Array.from(transfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) { selectionError.value = '不支持文件夹，请选择一份PDF。'; return }
  void selectCandidates(Array.from(transfer.files))
}
function applyTask(snapshot: ContractTask) {
  task.value = snapshot
  if (snapshot.result) result.value = snapshot.result
  stage.value = snapshot.state === 'completed' ? 'done' : snapshot.state === 'partial' ? 'partial' : snapshot.state === 'failed' ? 'error' : snapshot.state === 'cancelled' ? 'stopped' : snapshot.state === 'analyzing' ? 'analyzing' : snapshot.state === 'receiving' ? 'uploading' : 'parsing'
  if (['failed', 'partial', 'cancelled'].includes(snapshot.state)) errorMessage.value = snapshot.errorCode === 'CONTRACT_INCOMPLETE' ? '存在未完成块；已成功块不会自动重跑，可在预算和时限内手动重试失败部分。' : '任务未完整完成：' + (snapshot.errorCode ?? snapshot.state)
}
async function pause(signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 800)
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
  })
}
async function startAnalysis() {
  if (!file.value || !consent.value || busy.value || selecting.value || !isLoggedIn.value || stage.value === 'done') return
  const version = ++runVersion, ownerVersion = userStore.getSessionVersion(), candidate = file.value
  controller = new AbortController(); const signal = controller.signal
  errorMessage.value = ''; selectionError.value = ''; activeFinding.value = null; stage.value = 'uploading'
  try {
    limits.value = await getContractLimits(signal)
    if (candidate.size > limits.value.maxBytes) throw new Error('文件超过服务端当前大小上限。')
    let current: ContractTask | null = null
    if (taskId.value) {
      if (canRetryBlocks.value) current = await retryContractTask(taskId.value, signal)
      else try { current = await getContractTask(taskId.value, signal) } catch (error) { if (!(error instanceof ContractApiError && error.code === 'CONTRACT_NOT_FOUND')) throw error; releaseSession() }
    }
    if (current && ['failed', 'cancelled'].includes(current.state) && !current.chunks.length) { releaseSession(); current = null }
    if (!current) {
      result.value = null; task.value = null; taskId.value = crypto.randomUUID(); documentOwner = ownerVersion
      current = await uploadContractTask(candidate, taskId.value, signal, limits.value.uploadTimeoutMs + 15000)
    }
    const since = Date.now()
    while (version === runVersion) {
      applyTask(current)
      if (!['receiving', 'queued', 'parsing', 'analyzing'].includes(current.state)) break
      if (Date.now() - since > limits.value.taskTimeoutMs + 15000) { cancelAnalysis(); throw new Error('任务等待超时，已请求停止。') }
      await pause(signal); current = await getContractTask(taskId.value!, signal)
    }
  } catch (error) {
    if (version !== runVersion || signal.aborted) return
    stage.value = 'error'; errorMessage.value = error instanceof Error ? error.message : '任务失败，请重试。'
  } finally { if (version === runVersion) controller = null }
}
function locateFinding(finding: ContractFinding) {
  activeFinding.value = finding; currentPage.value = finding.page; pdfPreview.value?.open()
  previewPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
watch(() => userStore.sessionVersion.value, () => clearFile(), { flush: 'sync' })
watch(isLoggedIn, loggedIn => { if (loggedIn) void getContractLimits().then(value => { limits.value = value }).catch(() => {}) }, { immediate: true })
onBeforeUnmount(clearFile)
</script>

<style scoped>
.contract-page { min-height: 100%; color: #213c41; background: #f2f7f6; text-align: left; }
.contract-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 28px; background: #fff; border-bottom: 1px solid #e4e7ed; }
.contract-header h1 { font-size: 26px; margin: 6px 0; line-height: 1.4; }
.eyebrow { display: block; color: #45766d; font-size: 11px; letter-spacing: 1px; margin-bottom: 8px; }
.contract-header p { color: #606266; margin: 0; font-size: 13px; }
.header-actions, .upload-heading, .upload-actions, .finding-heading, .risk-counts { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.header-actions { justify-content: flex-end; }
.contract-main { max-width: 1440px; margin: 0 auto; padding: 24px; }
.upload-card { margin: 16px 0 24px; }
h2 { font-size: 18px; margin: 0 0 12px; }
.upload-heading h2 { margin: 0; }
.muted, .privacy-note, .stage-text { color: #606266; font-size: 13px; }
.drop-zone { display: flex; align-items: center; gap: 18px; padding: 24px; border: 1px dashed #90b4ac; border-radius: 12px; background: #f6faf9; transition: background .15s, border-color .15s; }
.drop-zone.dragging { background: #dff2ed; border: 2px solid #317b6d; padding: 23px; }
.drop-zone.disabled { background: #f7f8f8; border-color: #c7d2cf; }
.file-badge { flex: none; display: grid; place-items: center; width: 48px; height: 56px; color: #25695c; border-radius: 8px; background: #e2efeb; font-size: 13px; font-weight: 700; }
.drop-copy { flex: 1; min-width: 0; }
.drop-copy strong { font-size: 15px; overflow-wrap: anywhere; }
.drop-copy p { color: #637773; font-size: 13px; margin: 8px 0 0; line-height: 1.6; }
.file-input { display: none; }
.process-steps { list-style: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 16px 0 0; margin: 16px 0; border-top: 1px solid #e4edea; }
.process-steps li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #687976; }
.process-steps li > span { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #edf1f0; flex: none; }
.process-steps .active { color: #246859; font-weight: 600; }
.process-steps .active > span { color: #fff; background: #317b6d; }
.process-steps .done > span { color: #25695c; background: #e2efeb; }
.file-summary { margin: 10px 0; overflow-wrap: anywhere; font-size: 14px; }
.consent { margin: 12px 0; height: auto; white-space: normal; }
.consent :deep(.el-checkbox__label) { white-space: normal; line-height: 1.6; }
.upload-actions { margin-top: 6px; }
.status-alert { margin-top: 16px; }
.privacy-note { line-height: 1.7; margin-bottom: 0; }
.review-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.preview-panel, .result-panel { min-width: 0; }
.preview-panel { scroll-margin-top: 16px; }
.summary-card, .finding-card { margin-bottom: 16px; }
.summary-text, .finding-card p, .result-placeholder p { line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
.risk-counts { font-size: 13px; margin: 16px 0; }
.result-warning { color: #9a6700; font-size: 13px; line-height: 1.7; }
.finding-heading { justify-content: space-between; }
.finding-heading h3 { font-size: 16px; margin: 0; }
blockquote { border-left: 3px solid #a0cfff; background: #f4f8ff; padding: 12px 14px; margin: 16px 0; line-height: 1.8; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.active-quote p { margin-bottom: 0; }
.selected { border-color: #317b6d; box-shadow: 0 0 0 1px #317b6d; }
.upload-card :deep(.el-card__body) { padding: 24px; }
.upload-card, .review-grid :deep(.el-card) { border-radius: 12px; border-color: #e1eae7; box-shadow: 0 4px 16px #213c4105; }
@media (max-width: 900px) { .review-grid { grid-template-columns: 1fr; } .contract-main { padding: 12px; } .contract-header { padding: 16px; flex-wrap: wrap; } }
@media (max-width: 520px) { .upload-card :deep(.el-card__body) { padding: 16px; } .drop-zone { flex-wrap: wrap; padding: 16px; gap: 12px; } .drop-zone.dragging { padding: 15px; } .drop-zone > .el-button { width: 100%; } .process-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } .contract-header h1 { font-size: 23px; } .header-actions { gap: 8px; } .header-actions .el-button + .el-button { margin-left: 0; } }
</style>
