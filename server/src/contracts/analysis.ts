import { z } from 'zod';
import { AppError } from '../utils/AppError';
import type { ContractPage } from './pdf';

const findingSchema = z.strictObject({
  severity: z.enum(['high', 'medium', 'low']),
  category: z.string().trim().min(1).max(80),
  quote: z.string().trim().min(4).max(2000),
  page: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
  suggestion: z.string().trim().min(1).max(2000)
});
const analysisSchema = z.strictObject({ summary: z.string().trim().min(1).max(2000), findings: z.array(findingSchema).max(20) });
export type VerifiedFinding = z.infer<typeof findingSchema> & { id: string; sources?: { page: number; start: number; end: number }[] };
export interface ContractAnalysis {
  summary: string;
  findings: VerifiedFinding[];
  rejectedFindingCount: number;
  warnings: string[];
}

const normalizeQuote = (text: string) => text.normalize('NFC').replace(/\s+/gu, '');

export function verifyContractAnalysis(raw: unknown, pages: ContractPage[]): ContractAnalysis {
  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(502, 'AI_INVALID_SCHEMA', '模型结果结构不符合要求，请重试。');
  const pageTexts = new Map(pages.map(page => [page.page, normalizeQuote(page.text)]));
  const findings: VerifiedFinding[] = [];
  let rejectedFindingCount = 0;
  for (const finding of parsed.data.findings) {
    const text = pageTexts.get(finding.page);
    const quote = normalizeQuote(finding.quote);
    if (!text || !quote || !text.includes(quote)) { rejectedFindingCount++; continue; }
    findings.push({ ...finding, id: `finding-${findings.length + 1}` });
  }
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const warnings = ['原文核对只确认引用确实存在，不保证模型的风险判断正确；结果仅用于辅助理解与核实。'];
  if (rejectedFindingCount > 0) warnings.unshift(`有 ${rejectedFindingCount} 项因原文或页码无法核对而被移除，不应据此认为合同没有风险。`);
  return { summary: parsed.data.summary, findings, rejectedFindingCount, warnings };
}
