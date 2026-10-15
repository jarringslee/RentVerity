import path from 'node:path';
import { AppError } from '../utils/AppError';

export const PDF_LIMITS = { maxBytes: 10 * 1024 * 1024, maxPages: 40, maxCharacters: 60000 } as const;
export interface ContractPage { page: number; text: string }
export interface ParsedContract { pages: ContractPage[]; pageCount: number; characterCount: number }

export function validatePdfFile(file: { buffer: Buffer; originalname: string; mimetype: string }): void {
  if (file.buffer.length === 0 || file.buffer.length > PDF_LIMITS.maxBytes) throw new AppError(413, 'FILE_SIZE', 'PDF 不能为空且不能超过 10 MB。');
  if (!file.originalname.toLowerCase().endsWith('.pdf') || !['application/pdf', 'application/octet-stream'].includes(file.mimetype) || !file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw new AppError(400, 'FILE_TYPE', '请选择真正的 PDF 文件；暂不支持 DOC、DOCX 或图片。');
  }
}

export async function parseContractPdf(buffer: Buffer): Promise<ParsedContract> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const task = getDocument({
    data: Uint8Array.from(buffer),
    cMapUrl: path.join(pdfRoot, 'cmaps').replace(/\\/g, '/') + '/',
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfRoot, 'standard_fonts').replace(/\\/g, '/') + '/',
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    stopAtErrors: true,
    verbosity: 0
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void task.destroy(); }, 15000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > PDF_LIMITS.maxPages) throw new AppError(413, 'PDF_PAGE_LIMIT', '首版最多支持 40 页 PDF。');
    const pages: ContractPage[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
      characterCount += text.length;
      if (characterCount > PDF_LIMITS.maxCharacters) throw new AppError(413, 'PDF_TEXT_LIMIT', '提取文本超过 60000 字符，请拆分合同后分析。');
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
