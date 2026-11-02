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

## Cookie 鉴权与本地来源校验

本项目用于本地面试练习。服务端签发 HS256 JWT，放入 `rentverity_session` Cookie：HttpOnly、SameSite=Lax、Path=/、有效期 7 天、不设置 Domain；本地 HTTP 使用 Secure=false。JSON 只返回公开用户资料及 `sessionId`/`expiresAt` 元信息，不返回 JWT。HTTP 不再接受登录 Bearer，WebSocket 不再接受 `?token=...`。

| 请求 | 行为 |
| --- | --- |
| `POST /auth/register` | 创建账号并设置 Cookie，前端直接进入登录状态，再上传可选头像 |
| `POST /auth/login` | 校验密码后设置 Cookie；密码错误的 401 不清除已有 Cookie |
| `GET /users/me` | 通过 Cookie 恢复用户与会话元信息，响应不缓存；未登录/过期/用户不存在为 401 |
| `POST /auth/logout` | 清除同名同路径 Cookie，关闭当前会话已建立的聊天连接；有效 Cookie 须携带匹配的 `X-RentVerity-Session`，不匹配返回 409 且不清 Cookie |

浏览器所有 API Fetch（含 JSON、头像/合同 FormData、SSE）使用 `credentials: 'include'`。前端把非凭证 `sessionId` 放入 `X-RentVerity-Session`，后端有 Cookie 且该头存在时核对 JWT 的 jti，不一致返回 `409 SESSION_CHANGED`，拒绝共享 Cookie 切账号后的旧意图；这个头单独不能登录。前端据此重新核对身份并取消旧操作，不自动重放发布、上传或 SSE 请求。普通接口的 401 不发送清 Cookie 响应，避免迟到响应清掉新登录；身份恢复和认证结果响应均不缓存。

`CORS_ORIGINS` 是逗号分隔的完整前端来源（协议、主机、端口），未配置时默认允许 `http://localhost:5173`、`http://127.0.0.1:5173` 及这两个主机的 4173 端口。例如开发端口改为 5174，在被忽略的 `.env.local` 设置 `CORS_ORIGINS=http://localhost:5174`，重启服务端。前端与 API 应一致使用 localhost 或 127.0.0.1；`VITE_API_BASE_URL` 变更不能代替来源配置。Cookie 不按端口隔离，使用项目专属 Cookie 名避免与其他本地项目同名。

CORS 仅对明确允许的 Origin 返回凭证许可。POST/PATCH/PUT/DELETE 等写操作在 JSON/Multer 之前校验来源：Origin 存在时必须精确匹配；缺失时才解析 Referer 的 origin；两者都缺失或不可信返回 `403 CSRF_ORIGIN_INVALID`。伪造后缀、错误端口和 `Origin: null` 均拒绝，合法 Referer 不能覆盖非法 Origin。包括登录/注册/退出和 AI 请求；脚本测试也必须显式提供可信来源。GET/HEAD/OPTIONS 不得承担业务写入。这里采用轻量来源校验，没有额外 CSRF token 协议。

WebSocket 在升级前独立校验 Origin（不回退 Referer）和 Cookie，并要求子协议 `rentverity-chat` 与 `session.<sessionId>`；后者只隔离身份错配，认证依据仍是 Cookie 签名。服务端选中 `rentverity-chat`，按 JWT 到期关闭连接，退出时按会话 ID 关闭对应连接；消息仍检查会话成员。浏览器握手失败后手动重连前重新核对身份，不能用 HTTP CORS 代替 WS 来源校验。

边界：没有 refresh token、自动续期、会话数据库表或 JWT 撤销名单。退出不使已签发 JWT 永久作废，密码修改也不立即撤销其他会话；已开始的业务数据库操作不能由前端取消保证回滚。HttpOnly 不阻止 XSS 借用户浏览器发起请求，仍需文本转义和 Markdown 净化。

## 基础业务边界

注册在服务端校验用户名、手机号与密码，bcrypt 输入最多 72 UTF-8 字节，存储哈希而非明文。HTTP 与 WebSocket JWT 均限制 HS256 和正整数用户 ID；密码更新不撤销已签发 JWT，属于当前简化边界，不宣传完整会话撤销体系。

发布校验正整数租金/面积、成对合法坐标、字段长度、标签、图片 URL 与联系方式，owner 只取登录身份；不接受自报 riskLevel 或 owner_user_id。为兼容现有 INT 列，发布不接受小数租金/面积；预算筛选仍可使用小数，图片/拼接标签最多 255 字符。历史 risk_level 字段保留兼容但不用于 AI 评级。收藏验证房源存在并依赖唯一键幂等，按当前账号隔离。

聊天会话由用户对/房源唯一键去重；按房源联系时核对发布者，历史/已读/发言都检查会话成员。消息 limit 为 1—100、beforeId 为正整数，已读游标不会回退。WS 正文 1—2000 字符、最大帧 16 KiB，非法 JSON/结构返回错误，超大帧关闭连接；有基础手动重连，但没有自动重投、离线推送或生产级消息队列。业务错误日志仅保留错误码，不写 SQL 参数/连接信息。

## 合同接口

所有合同接口要求登录 Cookie；写请求还要通过上述来源校验。路由没有 `/api` 前缀，与现有 `/houses` 等保持一致。

| 请求 | 输入 | 结果 |
| --- | --- | --- |
| `POST /contracts/parse` | multipart 单文件字段 `file` | 临时 `documentId`、页数、字符数及过期时间 |
| `POST /contracts/analyze` | JSON `{ "documentId": "..." }` | 摘要、通过原文核对的风险项、移除项数量与说明 |
| `DELETE /contracts/:id` | 本人的临时 ID | 尽力清除未在分析中的临时会话；不存在/非本人不暴露差异 |

上传仅支持真实 PDF：最大 10 MB、40 页、提取文本 60000 字符；扫描件/无文本、密码保护或损坏文件明确返回错误。模型返回 JSON 后还要通过业务 schema、页码与连续原文校验；仅忽略排版空白和 Unicode 等价编码，不允许改写引用。

上传准入在 Multer 之前：当前进程每用户 6 次/60 秒、每 IP 30 次/60 秒（固定窗口，包括失败/忙碌尝试）；单用户一个上传/解析，全局最多 4 个。429 返回 Retry-After；限流映射有界，过期窗口在后续请求清理。上传 60 秒超时返回 408 并关闭连接，异常/中断释放上传槽位；若已进入 PDF 解析，则等待解析实际结束再释放，避免取消绕过并发限制。没有配置 trust proxy，不采信任意 X-Forwarded-For；反向代理/多实例部署须另外设计可信代理与共享限流。

扩展名/MIME 在文件接收前过滤，非空/大小/标准文件头在解析前复核；Multer 限制文件数、字段数和 multipart 项，已知 Content-Length 超限提前拒绝，未知长度仍由流式大小限制兜底。PDF 解析有 15 秒协作式超时，不能视为进程级 CPU/内存沙箱；本地预览只渲染有界 canvas，不挂载 PDF 脚本、附件或交互链接。没有杀毒/内容消毒服务，不承诺恶意文件绝对安全。上传依赖升级为 Multer 2.4，说明及安全修复见 [官方发布](https://github.com/expressjs/multer/releases/tag/v2.4.0)。

原 PDF 只在上传请求内存中处理，不写入公开 uploads 或磁盘。页文本/结果按账号隔离，15 分钟过期并每 30 秒清理；每用户最多两份临时会话、同时一个模型分析。已完成结果在有效期内复用，失败可手动重试，不自动付费重试。客户端取消会中断模型网络请求，但不能保证上游尚未计费。

没有合同历史表、长期会话、OCR、DOCX、RAG、流式正文或法律有效性保证。原文存在只验证引用，不验证风险判断、主体真实性或法律结论。

## AI 助手与房源筛选接口

助手接口要求登录，房源及城市列表公开读取。请求不带 `/api` 前缀。旧 `/assistant/search` 人工确认接口已移除。

| 请求 | 输入 | 结果 |
| --- | --- | --- |
| `POST /assistant/message` | `{ message, history?, context? }` | SSE：意图分流、受控自动查库、真实卡片与流式正文 |
| `GET /houses` | URL 条件及分页/排序 | 同一组参数化 WHERE 的列表与 total |
| `GET /houses/cities` | 无 | 发布表单可用的标准城市名，直辖市按整市 |

条件为可选 `city`、`location`、可选 `minPrice/maxPrice` 和 `houseTypes` 数组；金额 0—1000000，允许小数和仅下限，最小值不得超过最大值。房型白名单为 `一居室/两居室/三居室/合租`，查询独立 house_type 字段，不再在 SQL 中猜标题。已有库升级见 [数据库说明](database/README.md)。

AI 找房必须有来自用户原话的单个明确城市，不能仅凭模型参数/context/助手回答/个人资料推断。不明或歧义时澄清、不查库。受控工具只有 `search_houses` / `respond_to_user`：未知工具、额外 SQL/权限参数直接拒绝；只对漏调用、JSON 或参数类型错误做一次执行前纠错。语义冲突/不受支持条件需澄清，不做通用自动纠错；多个检索提议且没有唯一城市时整体拒绝执行、澄清城市，不选择其中一条查询。城市、可可靠识别的月租上下限（含 k/千/常见中文金额）、房型须与用户证据一致；忽略字数/套数/租期等非金额单位，不把押金当月租。每轮最多一次只读查询，取前六套；空结果不放宽。地铁/通勤等无可靠字段时提示限制。

所有事件携带服务端 `requestId` 与接受的 `callId`（尚未接受调用时为 null）：`start`、`status`（理解/纠错/查询/说明）、`context`（意图/条件/是否澄清）、`execution`（查询状态/次数/条数/耗时）、`houses`（真实结果）、`generation`（说明状态）、`delta`、`done` 或 `error`。执行器拥有状态，模型正文不能创建事件/卡片。查询必须 running→succeeded→houses，随后才可生成说明；检索完成必须有同一请求/调用/条件的结果，空数组合法。问答/澄清使用 not_required，无房源结果。前端状态机逐事件校验，缺结果但收到 done 不能成功。鉴权/输入/限流失败在 SSE 头前返回 HTTP JSON；流内失败以 error 摘要终结。

控制阶段由真实模型选择工具，业务参数经 Zod 和证据核对；正文阶段仅回传执行摘要，再转发上游 SSE 增量。澄清、空结果、合同引导和题外回复也由模型生成，本轮真实验收不以固定话术凑数。一般租房/法律常识由模型分流，移除旧关键词提前跳往合同页的冲突规则。模型不读取可写房源标题/描述，不获得 SQL、密钥或写权限；不保证所有语义理解正确。

查询与说明状态独立。查询失败不发卡片；说明失败/取消保留已经收到的卡片与成功条件，用户可明确重新发起一轮（会再次查询），系统不自动重跑。执行器记录结构化 requestId/callId、状态、modelCalls/correctionCount/queryCount、耗时、条数与错误码；不记录用户 ID、完整对话、工具参数、房源文本或上游原文。纠错日志保留触发错误码，完成后 errorCode 为 null。取消/身份到期会停止后续选择重试、查询和说明；已开始 SQL 不保证可取消，JWT 没有集中撤销体系。

Markdown 最终净化保持 HTML/图片禁用，并移除所有模型链接的 a 标签，只显示标签和纯文本目标地址；数据库卡片的详情/列表/地图按钮是独立可信入口。

`GET /houses` 的 `city` 为独立精确条件，`houseTypes` 逗号分隔；`page` 默认 1，`pageSize` 默认 10、最大 100；`sort` 为 `latest/price_asc/price_desc`。地段匹配地址或标题，城市/房型/金额/关键词均绑定参数，LIKE 通配符按字面量转义；字段、重复参数、数值和排序均校验，不把非法条件静默丢弃为不限。

地图与普通列表还可传 `bounds=west,south,east,north`，例如 `108.92,34.23,109.04,34.31`。四项为有限数值，经度在 ±180、纬度在 ±90 内，西小于东、南小于北；空值、反向/退化区间、重复参数均拒绝，不支持跨日期变更线。SQL 参数绑定 `lng BETWEEN west AND east AND lat BETWEEN south AND north`，列表/total 复用同一 WHERE，无坐标记录自然不匹配，不自动放宽。坐标约定 BD-09；旧迁移中的模拟点不代表已核实地址。

中心、缩放及选中 ID 只由前端 URL 恢复，不能作为多余参数发送给 `/houses`。助手不接受 bounds；入口只把城市/地段/预算/房型填成待发送文本，用户发送后再理解，避免偷偷继承地图范围或把 URL 当作城市对话证据。

助手消息最多 1500 字符，历史最多 12 条/合计 16000 字符，仅 user/assistant；前端进一步截取历史回复、限制合计字符，不宣称精确 token 计数。单用户一个活动请求、每分钟 12 次、单进程全局最多 8 个；上游每次超时按 AI_TIMEOUT_MS，本轮总截止 130 秒。心跳 12 秒，写入处理背压；断开/停止传播 AbortSignal，不保证上游尚未计费。模型事件总量/正文大小受限，校验 finish_reason 与 [DONE]，不暴露 reasoning_content；错误不包含上游请求或凭据。

当前会话前端按账号有界保存。未查询成功的失败/取消意图及半截说明不进入后续上下文；查询已成功时用户条件可保留，失败/取消说明仍排除。刷新不缓存库存卡片。没有长期记忆、后端多会话、推荐算法、RAG 或通用自主 Agent。两套 AI 上下文独立：合同保持完整 JSON 与引用核验，助手使用受控工具和 SSE。真实记录不代表房源认证；分层防护不能保证模型绝不受提示词注入影响。

## 真人聊天补齐与协议边界

`GET /chat/conversations/:id/messages?limit=50&beforeId=...` 要求会话成员，按 ID 游标取更早记录；每页最多100，响应按ID升序供合并。前端默认50条、最多展示500条，加载更早维持滚动锚点，15秒历史超时可重试，换会话/离开取消并隔离旧响应。手动重连重取最近记录；草稿只在当前页保留，不自动补发。

`POST /chat/conversations/:id/read` 新客户端提交 `{ "lastReadMessageId": 123 }`，游标必须属于当前会话；0代表尚未确认。服务端用 GREATEST 防回退，返回实际已存游标。旧客户端空正文保留标到最新的兼容行为；当前前端只在页面可见且处于底部时确认已展示到的ID，不把此实现说成逐条对端已读回执或跨设备实时已读同步。

WS帧有序不代表async数据库回调有序；每个连接以最多32个待处理任务串行处理，超限返回错误且不接收本条。页面将HTTP历史和WS实时消息按持久化ID去重/排序；只保证同连接队列及当前展示一致性，不保证跨连接/多实例业务全局顺序。没有ACK/outbox/断线自动重连/自动重投/图片消息/分布式消息总线。既有权限、纯文本、16KiB帧和2000字符限制仍适用。

## 验证

`npm test` 使用 Node 内置测试器、合成 PDF、本地 HTTP 模型协议桩及注入的查询测试替身，覆盖合同、模型、筛选、助手、Cookie 鉴权、来源拒绝和 WS 握手/到期/退出；不访问业务数据库或真实 DeepSeek。源码根的 `npm run test:session` 检查前端状态/请求模块的旧响应、认证串行和跨标签通知，使用 fetch/storage 替身；隔离库烟测和真实浏览器回归另行验证，不能用类型检查代替。

`npm run smoke:contract` 是显式真实调用：发送两页合成合同，打印结构/引用核对摘要，不输出 Key、完整上游响应或私人文件。执行前配置本项目 Key；未配置时返回 `AI_NOT_CONFIGURED`。测试结果和真实调用状态写外层开发记录。

`npm run smoke:assistant` 显式多次调用真实模型，覆盖缺城市、自动检索、跟进预算、流式问答、严格无结果与越界/合同隔离，并只读查业务库。逐次输出阶段及最终调用计数，不打印密钥/完整会话；次数随是否有匹配而变化。需要本项目 Key 和已升级数据库，固定用例不等于准确率测评。

`npm run smoke:assistant-reliability` 通过完整应用的 HTTP 登录/Cookie/CSRF/SSE 完成40轮真实 DeepSeek 参与的合成对话，分别计用户轮数、模型调用、仓库查询和 SELECT 数量，禁止写库；可用 `-- --cases=S01,S12,C03,Q01` 定向手动复测，多个 M 用例须同时包含 M01—M05。测试账号由 `RENTVERITY_TEST_USER/RENTVERITY_TEST_PASSWORD` 提供，或使用本机外层账号记录（不提交密码）。工具/正文都调用真实模型，错误不自动网络重试。报告写忽略的 `.codex_tmp/assistant-reliability-real-*.json`；这里保存的是显式测试的合成会话，生产审计日志不保存完整会话。浏览器回归在源码根运行 `npm run test:assistant:ui`，复现步骤和本轮结果见[验收报告](../docs/assistant-reliability-2026-11-02.md)。

接口失败带稳定 `code`，例如 `FILE_TYPE`、`PDF_NO_TEXT`、`AI_NOT_CONFIGURED`、`AI_INVALID_JSON`、`AI_INVALID_SCHEMA`、`AI_TIMEOUT`；不会向前端透出模型请求头、密钥或未校验的结果。

协议参考：[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[PDF.js 示例](https://mozilla.github.io/pdf.js/examples/)。
