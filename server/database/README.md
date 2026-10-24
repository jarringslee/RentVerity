# 新环境数据库

`schema.sql` 是当前结构快照，包含 users、houses、favorites 和三张聊天表，已合并历史 002—006。只用于新建空库；现有业务库不要运行本文件或重复执行历史迁移。模型会话不新增表。

2026-10-24 登录迁移为单 JWT + HttpOnly Cookie，不新增认证会话表，不需要数据库迁移/重建或清理账号。旧 localStorage 登录缓存由前端删除，升级后重新登录即可；未增加 refresh token 或数据库撤销机制。

## 已有库升级城市/房型（2026-10-16）

本机业务库已由本轮完成增量升级，正常启动无需再次操作。其他已有环境在 server 执行以下步骤；目标必须是该项目实际使用的现有库，不要只改 DB_NAME 或重建数据：

```powershell
npm run db:upgrade-search -- --database=你的现有库名
npm run db:upgrade-search -- --database=你的现有库名 --apply
```

第一条仅预览缺少字段/索引、待回填数量；第二条才写入。新增 nullable city/house_type 和 (city,price,id) 索引，仅按旧地址中的明确完整城市名、标题中的唯一支持房型回填 NULL，不覆盖已填写值或原地址/标题，无法确认保持 NULL。DDL 不随业务事务自动回滚，脚本可重复检查补齐；回填使用事务并有迁移互斥锁，执行前应确认目标/备份。应用账号需要该库 ALTER、INDEX、SELECT、UPDATE 等必要权限，不需要全局权限。

新空库快照和演示 seed 已包含这些字段，不需要再迁移。新发布必须有标准城市与房型；旧数据未知字段不会计入相应限定条件结果，不能把“查不到”解释为没有任何其他旧房源。库名/用户名保留原值。

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

源码根另开终端 `npm ci`、`npm run dev`。前端用 localhost 打开时 API 默认 `http://localhost:3001`，用 127.0.0.1 打开时默认 `http://127.0.0.1:3001`，可用 `VITE_API_BASE_URL` 覆盖；保持前后端主机一致。服务端默认信任 localhost/127.0.0.1 的 5173、4173 端口；实际前端端口不同时，在 `.env.local` 设置完整 `CORS_ORIGINS` 并重启服务端。Cookie 与来源校验的细节见 [服务端说明](../README.md#cookie-鉴权与本地来源校验)。地图沿用源码中的浏览器 AK，不是服务端模型 Key。

## 隔离业务验收

`npm test` 不连接业务数据库/真实模型。`npm run smoke:business` 会创建随机名 `rentverity_demo_test_<随机串>`，安装空库快照并写入合成测试账号、房源和消息，验收后删除且只删除本次新建的库。不使用现有业务账号或联系人，不调用模型。应用数据库账号若无 CREATE DATABASE/DROP DATABASE 权限，不为测试额外申请全局高权限，可请管理员提供一个专用空测试库：

```powershell
npm run smoke:business -- --database=rentverity_demo_test_local --confirm-empty-test-db
```

此模式要求目标名 `rentverity_demo_test_*` 且确实无表；为应用账号授予该测试库的建表、读写及删表权限。需要另验增量迁移时再补该精确库的 ALTER/INDEX；权限项中的下划线转义应与已有精确库权限一致，避免被更具体的旧权限项覆盖或意外扩大匹配。脚本只清理由本轮成功创建并记录的表，保留管理员创建的空库；非空时拒绝且不清理任何已有表。不要拿业务库代替测试库，测试期间不要同时在这个专用库操作。

检查范围：快照/seed 防误执行、注册/哈希/登录、发布校验及归属、详情/组合检索、收藏幂等/隔离、并发会话去重、HTTP/WS 越权拒绝、双向消息持久化、历史分页和未读/已读。通过固定场景不代表生产并发可靠性、全量安全审计或性能结论。

业务烟测现按测试账号分别接收登录 Cookie，再发送 Cookie、可信 Origin 与非凭证会话 ID；WS 同样使用 Cookie/Origin 与会话子协议，不再依赖返回 JSON 中的 token。`npm test` 的鉴权/来源/WS 边界使用本地 HTTP 与数据库替身，不连接业务数据库；前端另有 `npm run test:session`。浏览器回归与本地模型协议桩分别记录，不能把协议桩算作真实 DeepSeek 验收。

## 提交前检查

源码根执行 `npm run check:sensitive`。它只检查 Git 路径，不读取秘密、不修改索引：`.env*`（示例除外）、用户上传文件和常见私钥文件不能被跟踪。`.gitignore` 不会自动移除已跟踪的旧文件，需要用户精确执行 `git rm --cached -- <路径>` 后提交；本地文件保留。历史若包含真实凭证应轮换，停跟踪不能清除历史。用户资料/上传文件也不应继续随源码分发。
