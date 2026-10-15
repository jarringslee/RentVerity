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
}

export interface ContractAnalysis {
  summary: string
  findings: ContractFinding[]
  rejectedFindingCount: number
  warnings: string[]
}
