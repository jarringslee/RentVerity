# RentVerity 服务端

Node.js 22.13+、Express、TypeScript、MySQL、JWT、WebSocket；合同解析使用 PDF.js，模型结果使用 Zod 和原文或筛选条件校验。

## 启动与配置

在本目录运行 `npm install`、`npm run dev`。生产构建为 `npm run build`，运行构建结果为 `npm start`。

数据库与 JWT 配置保存在 `.env`，不要用 `.env.example` 覆盖已有配置。独立模型凭证放在被 Git 忽略的 `.env.local`；优先级是显式进程环境 → `.env.local` → `.env`，修改文件后重启服务端。

```dotenv
AI_API_KEY=
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
AI_TIMEOUT_MS=60000
```

只填写 RentVerity 的独立 Key，不复制另一项目的凭证。超时范围为 1000—120000 毫秒。示例模型名按当前 [DeepSeek 官方入门说明](https://api-docs.deepseek.com/) 选择，可按控制台可用模型调整。

`JWT_SECRET` 必填，生产入口在启动时检查；已有账号、房源、收藏和消息保留原数据库。新环境使用 [完整 schema/演示 seed 与隔离验收](database/README.md)，该快照已合并 002—006，现有环境不重复执行。

## 基础业务边界

注册在服务端校验用户名、手机号与密码，bcrypt 输入最多 72 UTF-8 字节，存储哈希而非明文。HTTP 与 WebSocket JWT 均限制 HS256 和正整数用户 ID；密码更新不撤销已签发 JWT，属于当前简化边界，不宣传完整会话撤销体系。

发布校验正整数租金/面积、成对合法坐标、字段长度、标签、图片 URL 与联系方式，owner 只取登录身份；不接受自报 riskLevel 或 owner_user_id。为兼容现有 INT 列，发布不接受小数租金/面积；预算筛选仍可使用小数，图片/拼接标签最多 255 字符。历史 risk_level 字段保留兼容但不用于 AI 评级。收藏验证房源存在并依赖唯一键幂等，按当前账号隔离。

聊天会话由用户对/房源唯一键去重；按房源联系时核对发布者，历史/已读/发言都检查会话成员。消息 limit 为 1—100、beforeId 为正整数，已读游标不会回退。WS 正文 1—2000 字符、最大帧 16 KiB，非法 JSON/结构返回错误，超大帧关闭连接；有基础手动重连，但没有自动重投、离线推送或生产级消息队列。业务错误日志仅保留错误码，不写 SQL 参数/连接信息。

## 合同接口

所有接口要求 `Authorization: Bearer <登录 token>`。路由没有 `/api` 前缀，与现有 `/houses` 等保持一致。

| 请求 | 输入 | 结果 |
| --- | --- | --- |
| `POST /contracts/parse` | multipart 单文件字段 `file` | 临时 `documentId`、页数、字符数及过期时间 |
| `POST /contracts/analyze` | JSON `{ "documentId": "..." }` | 摘要、通过原文核对的风险项、移除项数量与说明 |
| `DELETE /contracts/:id` | 本人的临时 ID | 尽力清除未在分析中的临时会话；不存在/非本人不暴露差异 |

上传仅支持真实 PDF：最大 10 MB、40 页、提取文本 60000 字符；扫描件/无文本、密码保护或损坏文件明确返回错误。模型返回 JSON 后还要通过业务 schema、页码与连续原文校验；仅忽略排版空白和 Unicode 等价编码，不允许改写引用。

原 PDF 只在上传请求内存中处理，不写入公开 uploads 或磁盘。页文本/结果按账号隔离，15 分钟过期并每 30 秒清理；每用户最多两份临时会话、同时一个模型分析。已完成结果在有效期内复用，失败可手动重试，不自动付费重试。客户端取消会中断模型网络请求，但不能保证上游尚未计费。

没有合同历史表、长期会话、OCR、DOCX、RAG、流式正文或法律有效性保证。原文存在只验证引用，不验证风险判断、主体真实性或法律结论。

## AI 助手与房源筛选接口

两个助手 POST 接口均要求登录，房源列表保持公开读取。请求不带 `/api` 前缀。

| 请求 | 输入 | 结果 |
| --- | --- | --- |
| `POST /assistant/message` | `{ message, history?, filters? }` | 经结构校验的意图、回答及可编辑筛选条件；不查房源 |
| `POST /assistant/search` | `{ filters }`，至少一项条件 | 数据库真实候选、匹配依据及总数，按月租升序最多六条 |
| `GET /houses` | URL 条件及分页/排序 | 同一组参数化 WHERE 的列表与 total |

`filters` 为 `location`、可选 `minPrice/maxPrice` 和 `houseTypes` 数组；金额范围 0—1000000，允许小数和仅下限，最小值不得超过最大值。房型白名单为 `一居室/两居室/三居室/合租`。现有表无独立房型字段，使用标题关键词并向用户明示，不新增迁移或改写数据。

`GET /houses` 的 `houseTypes` 用逗号分隔；`page` 默认 1，`pageSize` 默认 10、最大 100；`sort` 为 `latest/price_asc/price_desc`。区域匹配区域或标题，关键词和房型使用占位符参数，LIKE 通配符按字面量转义；字段、重复参数、数值和排序均校验，不把非法条件静默丢弃为不限。

地图与普通列表还可传 `bounds=west,south,east,north`，例如 `108.92,34.23,109.04,34.31`。四项为有限数值，经度在 ±180、纬度在 ±90 内，西小于东、南小于北；空值、反向/退化区间、重复参数均拒绝，不支持跨日期变更线。SQL 参数绑定 `lng BETWEEN west AND east AND lat BETWEEN south AND north`，列表/total 复用同一 WHERE，无坐标记录自然不匹配，不自动放宽。坐标约定 BD-09；旧迁移中的模拟点不代表已核实地址。

中心、缩放及选中 ID 只由前端 URL 恢复，不能作为多余参数发送给 `/houses`。助手条件 schema 不接受 bounds，去助手时只携带用户可编辑的区域/预算/房型，避免偷偷继承地图范围。

助手消息最多 1500 字符，历史最多 12 条/合计 16000 字符，仅允许 user/assistant；前端进一步限制上下文大小。服务端每用户仅一个进行中的模型调用，断开请求会传播取消。模型只抽取白名单条件或回答租房问题，没有 SQL/数据库工具权限；确认检索不调用模型。明确的合同审阅请求引导去合同页，不读取合同、用户画像或真人聊天。

当前会话仅前端按账号有界保存，不写 AI 消息表，不做长期记忆、推荐算法、RAG、Agent 或流式正文。筛选结果是真实数据库记录，不代表房源认证。模型语义遵循与问答质量依赖模型，不以结构校验保证回答事实正确。

## 验证

`npm test` 使用 Node 内置测试器、合成 PDF、本地 HTTP 模型协议桩及注入的查询测试替身，覆盖合同、模型、筛选和助手；不访问业务数据库或真实 DeepSeek。

`npm run smoke:contract` 是显式真实调用：发送两页合成合同，打印结构/引用核对摘要，不输出 Key、完整上游响应或私人文件。执行前配置本项目 Key；未配置时返回 `AI_NOT_CONFIGURED`。测试结果和真实调用状态写外层开发记录。

`npm run smoke:assistant` 显式进行五次真实模型调用，覆盖条件提取、跟进改预算、租房问答、越界和模糊条件，并只读查询当前业务数据库。合同引导不产生模型调用；输出汇总而非密钥/完整会话。需要本项目 Key 和现有数据库，固定用例不等于准确率测评。

接口失败带稳定 `code`，例如 `FILE_TYPE`、`PDF_NO_TEXT`、`AI_NOT_CONFIGURED`、`AI_INVALID_JSON`、`AI_INVALID_SCHEMA`、`AI_TIMEOUT`；不会向前端透出模型请求头、密钥或未校验的结果。

协议参考：[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[PDF.js 示例](https://mozilla.github.io/pdf.js/examples/)。
