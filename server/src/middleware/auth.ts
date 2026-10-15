import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwt';

type JwtPayload = {
  userId: number;
};

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as JwtPayload;
    if (!Number.isSafeInteger(payload.userId) || payload.userId <= 0) throw new Error('invalid user');
    (req as any).userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }
};

