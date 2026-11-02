export interface ParsedContract {
  documentId: string
  filename: string
  pageCount: number
  characterCount: number
  expiresAt: string
}

export interface ContractFinding {
  id: string
  severity: 'high' | 'medium' | 'low'
  category: string
  quote: string
  page: number
  reason: string
  suggestion: string
  sources?: { page: number; start: number; end: number }[]
}

export interface ContractLimits {
  maxBytes: number; maxPages: number; maxCharacters: number; maxChunks: number
  uploadTimeoutMs: number; taskTimeoutMs: number; ttlMs: number; maxFindings: number
}
export interface ContractTask {
  taskId: string; filename: string; state: 'receiving' | 'queued' | 'parsing' | 'analyzing' | 'partial' | 'completed' | 'failed' | 'cancelled'
  byteLength: number; receivedBytes: number; pageCount: number; characterCount: number; expiresAt: string
  errorCode: string | null; cleanupPending: boolean; result: ContractAnalysis | null
  chunks: { id: number; state: 'pending' | 'running' | 'succeeded' | 'failed'; attempts: number; errorCode: string | null }[]
  stats: { modelCalls: number; retries: number; manualRetries: number; elapsedMs: number; inputMaxCharacters: number }
}

export interface ContractAnalysis {
  summary: string
  findings: ContractFinding[]
  rejectedFindingCount: number
  warnings: string[]
}
