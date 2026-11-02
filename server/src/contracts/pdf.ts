import path from 'node:path';
import { AppError } from '../utils/AppError';
import { readContractLimits } from './limits';

export const PDF_LIMITS = readContractLimits();
export interface ContractPage { page: number; text: string }
export interface ParsedContract { pages: ContractPage[]; pageCount: number; characterCount: number }

export function validatePdfMetadata(file: { originalname: string; mimetype: string }): void {
  if (!file.originalname.toLowerCase().endsWith('.pdf') || !['application/pdf', 'application/octet-stream'].includes(file.mimetype)) {
    throw new AppError(400, 'FILE_TYPE', '请选择真正的 PDF 文件；暂不支持 DOC、DOCX 或图片。');
  }
}

export function validatePdfFile(file: { buffer: Buffer; originalname: string; mimetype: string }): void {
  validatePdfMetadata(file);
  if (file.buffer.length === 0 || file.buffer.length > PDF_LIMITS.maxBytes) throw new AppError(413, 'FILE_SIZE', 'PDF 大小超出当前限制。');
  // 本项目只接受标准 PDF 文件头，不接受在可执行/HTML 文件后拼接的伪装内容。
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n|\s)/.test(file.buffer.subarray(0, 16).toString('latin1'))) throw new AppError(400, 'FILE_TYPE', '文件内容不是标准 PDF，请重新导出为文字型 PDF。');
}

// 生产链路只在 parserWorker 子进程调用；导出供小样本单元测试。
export async function parseContractPdf(buffer: Buffer, limits = PDF_LIMITS): Promise<ParsedContract> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const task = getDocument({
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    cMapUrl: path.join(pdfRoot, 'cmaps').replace(/\\/g, '/') + '/',
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfRoot, 'standard_fonts').replace(/\\/g, '/') + '/',
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    enableXfa: false,
    maxImageSize: 0,
    stopAtErrors: true,
    verbosity: 0
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void task.destroy(); }, limits.parserTimeoutMs);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > limits.maxPages) throw new AppError(413, 'PDF_PAGE_LIMIT', `PDF 超过 ${limits.maxPages} 页限制。`);
    const pages: ContractPage[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim().normalize('NFC');
      characterCount += text.length;
      if (characterCount > limits.maxCharacters) throw new AppError(413, 'PDF_TEXT_LIMIT', `提取文本超过 ${limits.maxCharacters} 字符限制。`);
      pages.push({ page: pageNumber, text });
      page.cleanup();
    }
    if (characterCount < 20) throw new AppError(422, 'PDF_NO_TEXT', '无法提取足够文字，可能是扫描件；当前只支持文字型 PDF，不支持 OCR。');
    return { pages, pageCount: pdf.numPages, characterCount };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (timedOut) throw new AppError(422, 'PDF_PARSE_TIMEOUT', 'PDF 解析超时，请换用较小的文字型 PDF。');
    if (error instanceof Error && error.name === 'PasswordException') throw new AppError(422, 'PDF_ENCRYPTED', '暂不支持加密 PDF，请先移除密码。');
    throw new AppError(422, 'PDF_INVALID', 'PDF 无法解析，文件可能损坏或格式不受支持。');
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
