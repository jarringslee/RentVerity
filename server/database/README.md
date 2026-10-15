# 新环境数据库

`schema.sql` 是当前结构快照，包含 users、houses、favorites 和三张聊天表，已合并历史 002—006。只用于新建空库；现有业务库不要运行本文件或重复执行历史迁移。模型会话不新增表。

## 从零启动

需要 MySQL 8+、Node.js 22.13+。管理员手动创建空库（如 `rentverity_demo`），为应用账号授予该库所需权限。不要把真实凭证写进 SQL 或提交到 Git。

在 server 配置被忽略的 `.env.local`：数据库连接、`DB_NAME`、强随机 `JWT_SECRET` 与本项目独立 AI Key；字段见 `server/.env.example`。显式进程环境变量优先，其次 `.env.local`，最后 `.env`，修改文件后重启。已有环境不复制覆盖配置。

在 server 执行：

```powershell
npm ci
npm run db:init -- --database=rentverity_demo --confirm-empty
```

脚本要求显式目标，连接到服务器后核对目标库存在且无表，不隐式采用 `DB_NAME`。非空拒绝；不建库、不删库、不清表。MySQL DDL 不保证事务回滚，若中途失败，应由管理员核对这个新库，不要向已有业务库反复重跑。

演示数据可选，仅允许目标名 `rentverity_demo` 或 `rentverity_demo_*`，且 users/houses 必须为空。先在 `.env.local` 设置临时 `DEMO_PASSWORD`（至少 8 字符、最多 72 UTF-8 字节），再运行：

```powershell
npm run db:seed -- --database=rentverity_demo --confirm-demo
npm run dev
```

演示账号 `demo_landlord`、`demo_tenant` 使用你设置的密码；脚本不输出密码。两套房源、电话号码与坐标仅供学习，不是认证或真实可租赁信息。新环境不再运行旧迁移 004 的坐标回填。

源码根另开终端 `npm ci`、`npm run dev`；前端默认访问 `http://localhost:3001`，自定义可用 `VITE_API_BASE_URL`。地图沿用源码中的浏览器 AK，部署域名权限需要自行配置；浏览器 AK 不是服务端模型 Key。

## 隔离业务验收

`npm test` 不连接业务数据库/真实模型。`npm run smoke:business` 会创建随机名 `rentverity_demo_test_<随机串>`，安装空库快照并写入合成测试账号、房源和消息，验收后删除且只删除本次新建的库。不使用现有业务账号或联系人，不调用模型。应用数据库账号若无 CREATE DATABASE/DROP DATABASE 权限，不为测试额外申请全局高权限，可请管理员提供一个专用空测试库：

```powershell
npm run smoke:business -- --database=rentverity_demo_test_local --confirm-empty-test-db
```

此模式要求目标名 `rentverity_demo_test_*` 且确实无表；为应用账号授予该测试库的建表、读写及删表权限。脚本只清理由本轮成功创建并记录的表，保留管理员创建的空库；非空时拒绝且不清理任何已有表。不要拿业务库代替测试库，测试期间不要同时在这个专用库操作。

检查范围：快照/seed 防误执行、注册/哈希/登录、发布校验及归属、详情/组合检索、收藏幂等/隔离、并发会话去重、HTTP/WS 越权拒绝、双向消息持久化、历史分页和未读/已读。通过固定场景不代表生产并发可靠性、全量安全审计或性能结论。

## 提交前检查

源码根执行 `npm run check:sensitive`。它只检查 Git 路径，不读取秘密、不修改索引：`.env*`（示例除外）、用户上传文件和常见私钥文件不能被跟踪。`.gitignore` 不会自动移除已跟踪的旧文件，需要用户精确执行 `git rm --cached -- <路径>` 后提交；本地文件保留。历史若包含真实凭证应轮换，停跟踪不能清除历史。用户资料/上传文件也不应继续随源码分发。
