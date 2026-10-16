// 与服务端 PDF_LIMITS 对齐；客户端只改善体验，服务端仍独立校验。
export const CONTRACT_FILE_LIMITS = { maxBytes: 10 * 1024 * 1024, maxPages: 40, maxCharacters: 60000 } as const

export async function validateContractSelection(files: readonly File[]): Promise<File> {
  if (files.length !== 1) throw new Error('每次只能选择一份 PDF；不支持文件夹或多文件。')
  const file = files[0]!
  if (!file.name.toLowerCase().endsWith('.pdf') || !['', 'application/pdf', 'application/octet-stream'].includes(file.type)) throw new Error('仅支持文字型 PDF，暂不支持图片、DOC/DOCX。')
  if (!file.size || file.size > CONTRACT_FILE_LIMITS.maxBytes) throw new Error('PDF 不能为空且不能超过 10 MB。')
  const header = new TextDecoder('latin1').decode(await file.slice(0, 16).arrayBuffer())
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n|\s)/.test(header)) throw new Error('文件内容不是标准 PDF，请重新导出；仅修改扩展名无效。')
  return file
}
