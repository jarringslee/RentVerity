import type { Request, Response, NextFunction } from 'express';
import { verifySession, SESSION_HEADER } from '../auth/session';

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const payload = verifySession(req.headers);
    const expected = req.get(SESSION_HEADER);
    if (expected && expected !== payload.jti) {
      return res.status(409).json({ success: false, code: 'SESSION_CHANGED', message: '登录账号已变化，请重新操作。' });
    }
    (req as any).userId = payload.userId;
    (req as any).session = payload;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }
};

