/** 不把 SQL 参数、账号资料、上传内容或连接配置写入日志。 */
export function logSafeError(error: unknown) {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  console.error('Business operation failed', { code: typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'UNEXPECTED' });
}
