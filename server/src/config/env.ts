import path from 'node:path';
import dotenv from 'dotenv';

// 路径同时兼容 src/config（开发）和 dist/config（生产）。本地密钥覆盖普通配置。
const serverRoot = path.resolve(__dirname, '../..');
// 显式进程环境优先，便于 CI/隔离测试；文件内部仍是 .env.local 覆盖 .env。
const fileEnv: Record<string, string> = {};
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true, processEnv: fileEnv });
dotenv.config({ path: path.join(serverRoot, '.env.local'), override: true, quiet: true, processEnv: fileEnv });
for (const [key, value] of Object.entries(fileEnv)) if (process.env[key] === undefined) process.env[key] = value;
