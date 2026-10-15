import path from 'node:path';
import dotenv from 'dotenv';

// 路径同时兼容 src/config（开发）和 dist/config（生产）。本地密钥覆盖普通配置。
const serverRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });
dotenv.config({ path: path.join(serverRoot, '.env.local'), override: true, quiet: true });
