import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Response, CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwt';

export const SESSION_COOKIE = 'rentverity_session';
export const SESSION_HEADER = 'x-rentverity-session';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const cookieOptions: CookieOptions = { httpOnly: true, sameSite: 'lax', path: '/', secure: false };

export type SessionClaims = { userId: number; jti: string; exp: number };

export function createSession(userId: number, secret = getJwtSecret()) {
  const sessionId = randomUUID();
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = jwt.sign({ userId, exp: expires }, secret, { algorithm: 'HS256', jwtid: sessionId });
  return { token, sessionId, expiresAt: new Date(expires * 1000).toISOString() };
}

export function setSessionCookie(res: Response, session: ReturnType<typeof createSession>) {
  res.cookie(SESSION_COOKIE, session.token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 });
  res.setHeader('Cache-Control', 'no-store');
  // sessionId 仅用于隔离旧请求，不具备认证能力；JWT 只通过 HttpOnly Cookie 返回。
  return { sessionId: session.sessionId, expiresAt: session.expiresAt };
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
  res.setHeader('Cache-Control', 'no-store');
}

export function readSessionCookie(headers: IncomingHttpHeaders): string | null {
  const matches = (headers.cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  try {
    const token = decodeURIComponent(matches[0]!.slice(SESSION_COOKIE.length + 1));
    return token && token.length <= 4096 ? token : null;
  } catch { return null; }
}

export function verifySession(headers: IncomingHttpHeaders, ignoreExpiration = false): SessionClaims {
  const token = readSessionCookie(headers);
  if (!token) throw new Error('missing session cookie');
  const claims = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'], ignoreExpiration });
  if (typeof claims === 'string' || !Number.isSafeInteger(claims.userId) || claims.userId <= 0 ||
    typeof claims.jti !== 'string' || !/^[0-9a-f-]{36}$/.test(claims.jti) ||
    !Number.isSafeInteger(claims.exp) || claims.exp! <= 0) throw new Error('invalid session');
  return claims as SessionClaims;
}
