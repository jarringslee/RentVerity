<template>
  <div class="contract-page">
    <header class="contract-header">
      <div><h1>合同风险分析</h1><p>安心租 RentVerity · 用原文核对 AI 的提示</p></div>
      <div class="header-actions"><el-button @click="router.push('/')">返回首页</el-button><HeaderUserMenu v-if="isLoggedIn" /></div>
    </header>
    <main class="contract-main">
      <el-alert v-if="!isLoggedIn" title="请先登录，再上传合同进行分析。" type="info" :closable="false" show-icon>
        <el-button type="primary" @click="router.push('/login')">前往登录</el-button>
      </el-alert>
      <el-card class="upload-card">
        <div class="upload-heading"><h2>选择一份文字型 PDF</h2><el-tag type="info">单文件 ≤10 MB · ≤40 页</el-tag></div>
        <p class="muted">仅支持可提取文字的 PDF，提取文本最多 60000 字符。暂不支持扫描件、加密 PDF、DOC/DOCX。</p>
        <label class="file-label" for="contract-file">合同文件</label>
        <input id="contract-file" ref="fileInput" type="file" accept="application/pdf,.pdf" :disabled="busy || !isLoggedIn" @change="selectFile" />
        <div v-if="file" class="file-summary">{{ file.name }} · {{ (file.size / 1024 / 1024).toFixed(2) }} MB <span v-if="parsed"> · {{ parsed.pageCount }} 页 / {{ parsed.characterCount }} 字符</span></div>
        <el-checkbox v-model="consent" :disabled="busy || !isLoggedIn" class="consent">我确认可使用该文件，并同意将提取文本发送至 DeepSeek 分析；请先移除个人敏感信息。</el-checkbox>
        <div class="upload-actions">
          <el-button type="primary" :disabled="!file || !consent || !isLoggedIn || !!result" :loading="busy" @click="startAnalysis">{{ errorMessage ? '重新分析' : '开始分析' }}</el-button>
          <el-button v-if="busy" @click="cancelAnalysis">停止本次请求</el-button>
          <el-button v-else :disabled="!file" @click="clearFile">清除文件</el-button>
          <span class="stage-text" role="status">{{ stageText }}</span>
        </div>
        <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon class="status-alert" />
        <p class="privacy-note">原 PDF 不写入服务器磁盘；页文本与结果在服务端 15 分钟后过期并定期清理，清除文件或离开页面后不提供历史记录。取消请求不能保证模型服务未计费。</p>
      </el-card>

      <div v-if="file" class="review-grid">
        <section ref="previewPanel" class="preview-panel">
          <el-card><template #header><h2>合同原文</h2></template>
            <ContractPdfPreview :file="file" v-model:page="currentPage" />
            <blockquote v-if="activeFinding" class="active-quote"><strong>第 {{ activeFinding.page }} 页引用</strong><p>{{ activeFinding.quote }}</p></blockquote>
          </el-card>
        </section>
        <section class="result-panel" aria-label="合同分析结果">
          <el-card v-if="!result" class="result-placeholder">
            <h2>{{ busy ? stageText : '分析结果将在这里展示' }}</h2>
            <p>每条风险提示都需要包含原文、所在页码、原因和建议。点击结果可切换到对应合同页。</p>
            <p v-if="busy">模型可能需要一段时间，当前没有使用模拟分析结果。</p>
          </el-card>
          <template v-else>
            <el-card class="summary-card">
              <h2>AI 合同摘要</h2><p class="summary-text">{{ result.summary }}</p>
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
import { analyzeContract, ContractApiError, discardContract, parseContract } from '../services/contracts'
import type { ContractAnalysis, ContractFinding, ParsedContract } from '../types/contracts'

const router = useRouter()
const isLoggedIn = computed(() => userStore.isLoggedIn())
const file = shallowRef<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const previewPanel = ref<HTMLElement | null>(null)
const consent = ref(false)
const parsed = ref<ParsedContract | null>(null)
const result = ref<ContractAnalysis | null>(null)
const activeFinding = ref<ContractFinding | null>(null)
const currentPage = ref(1)
const stage = ref<'idle' | 'parsing' | 'analyzing' | 'done'>('idle')
const errorMessage = ref('')
const busy = computed(() => stage.value === 'parsing' || stage.value === 'analyzing')
const stageText = computed(() => ({ idle: file.value ? '已选择文件' : '待选择文件', parsing: '正在上传并解析 PDF…', analyzing: '正在分析并核对原文…', done: '分析完成，请逐条核实提示' })[stage.value])
const severityNames = { high: '高', medium: '中', low: '低' }
const counts = computed(() => (result.value?.findings ?? []).reduce((all, finding) => { all[finding.severity]++; return all }, { high: 0, medium: 0, low: 0 }))
let controller: AbortController | null = null
let runVersion = 0

function releaseSession() {
  if (parsed.value) void discardContract(parsed.value.documentId).catch(() => {})
  parsed.value = null
}

function cancelAnalysis() {
  ++runVersion
  controller?.abort()
  controller = null
  stage.value = 'idle'
}

function clearFile() {
  cancelAnalysis()
  releaseSession()
  file.value = null
  result.value = null
  activeFinding.value = null
  currentPage.value = 1
  errorMessage.value = ''
  consent.value = false
  if (fileInput.value) fileInput.value.value = ''
}

function selectFile(event: Event) {
  const next = (event.target as HTMLInputElement).files?.[0]
  clearFile()
  if (!next) return
  if (!next.name.toLowerCase().endsWith('.pdf') || next.size === 0 || next.size > 10 * 1024 * 1024) {
    errorMessage.value = '请选择不超过 10 MB 的非空 PDF 文件。'
    return
  }
  file.value = next
}

async function startAnalysis() {
  if (!file.value || !consent.value || busy.value || !isLoggedIn.value) return
  const version = ++runVersion
  controller = new AbortController()
  const signal = controller.signal
  result.value = null
  activeFinding.value = null
  errorMessage.value = ''
  try {
    if (!parsed.value || new Date(parsed.value.expiresAt).getTime() <= Date.now()) {
      releaseSession()
      stage.value = 'parsing'
      const document = await parseContract(file.value, signal)
      if (version !== runVersion) { void discardContract(document.documentId).catch(() => {}); return }
      parsed.value = document
    }
    stage.value = 'analyzing'
    const analysis = await analyzeContract(parsed.value.documentId, signal)
    if (version !== runVersion) return
    result.value = analysis
    stage.value = 'done'
  } catch (error) {
    if (version !== runVersion || signal.aborted) return
    if (error instanceof ContractApiError && error.code === 'CONTRACT_NOT_FOUND') releaseSession()
    errorMessage.value = error instanceof Error ? error.message : '分析失败，请重试。'
    stage.value = 'idle'
  } finally { if (version === runVersion) controller = null }
}

function locateFinding(finding: ContractFinding) {
  activeFinding.value = finding
  currentPage.value = finding.page
  previewPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(isLoggedIn, logged => { if (!logged) clearFile() })
onBeforeUnmount(() => { cancelAnalysis(); releaseSession() })
</script>

<style scoped>
.contract-page { min-height: 100%; color: #303133; background: #f5f7fa; text-align: left; }
.contract-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 28px; background: #fff; border-bottom: 1px solid #e4e7ed; }
.contract-header h1 { font-size: 24px; margin: 0 0 6px; line-height: 1.4; }
.contract-header p { color: #606266; margin: 0; font-size: 13px; }
.header-actions, .upload-heading, .upload-actions, .finding-heading, .risk-counts { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.header-actions { justify-content: flex-end; }
.contract-main { max-width: 1440px; margin: 0 auto; padding: 24px; }
.upload-card { margin: 16px 0 24px; }
h2 { font-size: 18px; margin: 0 0 12px; }
.upload-heading h2 { margin: 0; }
.muted, .privacy-note, .stage-text { color: #606266; font-size: 13px; }
.file-label { margin-right: 12px; font-size: 14px; }
input[type=file] { max-width: 100%; margin: 8px 0; }
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
.selected { border-color: #409eff; }
@media (max-width: 900px) { .review-grid { grid-template-columns: 1fr; } .contract-main { padding: 12px; } .contract-header { padding: 16px; flex-wrap: wrap; } }
</style>
