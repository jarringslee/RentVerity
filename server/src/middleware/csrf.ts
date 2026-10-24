import type { IncomingHttpHeaders } from 'node:http';
import type { RequestHandler } from 'express';

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];

export function allowedOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS;
  return configured === undefined ? LOCAL_ORIGINS : configured.split(',').map(value => value.trim()).filter(Boolean);
}

export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && allowedOrigins().includes(origin);
  } catch { return false; }
}

export function hasTrustedSource(headers: IncomingHttpHeaders, allowReferer = true): boolean {
  // Origin 存在但非法时直接拒绝，不能用 Referer 绕过。
  if (headers.origin !== undefined) return isAllowedOrigin(headers.origin);
  if (!allowReferer || !headers.referer) return false;
  try { return isAllowedOrigin(new URL(headers.referer).origin); } catch { return false; }
}

export const requireTrustedSource: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || hasTrustedSource(req.headers)) return next();
  return res.status(403).json({ success: false, code: 'CSRF_ORIGIN_INVALID', message: '请求来源校验失败，请从本项目页面重试。' });
};
