import './env';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error('请在服务端配置 JWT_SECRET');
  return secret;
}
