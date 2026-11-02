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

## 合同任务接口

要求登录Cookie；写请求须可信Origin及匹配的非凭证会话标识。没有 `/api` 前缀。不新增数据库表。

| 请求 | 输入 | 结果 |
| --- | --- | --- |
| `GET /contracts/limits` | 登录态 | 当前支持边界，不缓存 |
| `POST /contracts/tasks` | multipart单文件字段file；`X-Contract-Task-Id`为小写UUID，`X-Contract-File-Size`为实际文件字节 | 完整接收后202，任务快照；后台隔离解析/分块分析 |
| `GET /contracts/tasks/:id` | 本人任务 | 进度、块状态、尝试次数、错误码、已核验结果；不返回全文 |
| `POST /contracts/tasks/:id/retry` | 本人未完成任务 | 仅一次手动重试失败块，成功块复用 |
| `DELETE /contracts/tasks/:id` | 本人任务 | 取消、等待写入/解析/模型退出及回收；幂等，不暴露他人任务 |
| 旧 `POST /contracts/parse` / `analyze` | 任意 | 410，防止绕过新管线 |

默认同时限制100MiB、300页、600000字符、64块；301页/600001字符在模型前拒绝。扩展名/MIME、标准文件头、实际PDF解析均需通过。无文本、加密、损坏文件拒绝；PDF.js只在独立子进程运行，主服务不接收完整文件Buffer。开发启动先构建解析worker；修改worker或其依赖后需重新运行 `npm run dev` 生成最新构建。

先鉴权/来源校验，再按用户6次、IP30次/60秒限流；账号同时1个活动任务、全局4个，覆盖接收、解析、分析全过程。每用户最多2份、全局最多64份临时任务。接收前串行预留“原文件+解析输出上限+1MiB元数据”；原文件与半成品、输出与半成品通过原子改名共用空间。逻辑配额512MiB，真实可用空间额外保留256MiB。预留不足507，不能先写满再检查；外部进程仍可能消耗磁盘，写入失败必须清理，逻辑预留不是OS级磁盘预分配。

Busboy只允许file单文件、无其他字段，实际文件字节须等于声明且不超上限，HTTP与multipart都完整结束才原子改名为original.pdf进入解析。上传默认180秒。临时根目录默认 `server/.private/contracts-v1`，不得置于公开uploads，不采用客户端文件名作为路径；保留私有目录/文件权限（Windows继承本机ACL）。目录锁拒绝另一活跃实例共用，启动时只清理本命名空间遗留任务目录；不要手工删除活跃实例的锁。

解析进程默认并发2、90秒、384MiB V8 old-space、12MiB输出、16KiB stdout/stderr；超时/取消/异常输出会终止进程，并等待退出后释放槽位。环境仅传SystemRoot/WINDIR/LANG，不继承AI/DB/JWT/NODE_OPTIONS等。V8堆上限不是总RSS硬上限；同一OS账号进程仍有文件系统权限，这不是完整安全沙箱或病毒查杀。

解析子进程另有独立守护线程，每约200ms检查父PID与硬截止，防父服务崩溃后解析遗留；孤儿截止为解析时限+1秒，正常仍由父服务90秒终止。确定性测试用阻塞解析主线程的子进程验证父PID死亡和硬截止；不承诺OS调度下精确实时终止。

段落/条款切分默认每块10000字符、重叠500、共享背景1200，最多24段/块；超长单页继续拆分。保留原页码及NFC提取页文本的UTF-16起止位置，非PDF字节或画面坐标。序列化后的单次消息content总计最多16000字符，预留3600输出token；字符上限不是精确token数，不能保证所有模型上下文等价。每合同最多96次实际API尝试，全局模型并发2，每块至多一次自动重试可重试错误；手动一次仅补失败块，仍受原始总调用和12分钟时限约束。取消/身份到期后不再重试。

单块最多6项，经Zod、同一原页连续原文核验（仅忽略空白及NFC等价）后，服务端按规范化类别+引用精确去重，再按严重程度/页码/位置排序，整份最多20项。不进行语义去重、不调用模型作全文二次汇总；本地摘要拼合有限块摘要，不能当作全局法律结论。伪造/块外引用移除并计数，未完成块存在时不能标为completed，即使其余结果可展示。状态为receiving→queued/parsing→analyzing→completed/partial/failed/cancelled。

解析后尽早删除原文件与解析产物，终态重复清理；删除失败保留配额并标记cleanupPending，后续清扫重试，不虚假释放空间。活动任务最长12分钟（不超过JWT到期），终态TTL15分钟，30秒清扫，启动清遗留；不依赖页面关闭或WS。成功后清空块原文缓存，部分失败仅保留重试必需的有界文本直到TTL。任务元数据只在内存，服务重启需重新上传，不支持历史/恢复。日志只含任务/块ID、状态、页数/字符/块/API次数、耗时/主进程RSS和错误码，不含文件名、正文、身份或模型上游原文。

配置见 `.env.example` 的CONTRACT_*。扫描件OCR、加密、图片/DOC/DOCX、浏览器文件持久化、分片上传/续传、RAG、分布式队列和完整沙箱均未实现。引用存在不证明风险判断正确；停止不保证模型尚未计费。验证与真实模型逐任务数据见 [验收报告](../docs/contract-large-reliability-2026-11-02.md)。

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

`npm run smoke:contract` 通过真实HTTP登录、Cookie/Origin/会话标识、multipart上传、任务轮询、隔离解析和DeepSeek执行一份合成合同。`npm run smoke:contract-long` 自动执行35种样本，至少30个真实任务，不把多个块算成多份合同；可加 `-- --cases=R09,R13,R35` 定向复测。分别统计任务、块、API尝试、重试和失败，原始合成测试证据在忽略的 `.codex_tmp/contract-long-real-*.json`。测试账号从 `RENTVERITY_TEST_USER/RENTVERITY_TEST_PASSWORD` 提供，或使用本机外层账号记录；密码不得提交或输出。生产限流保持不变，显式验收进程只提高测试限流，不暴露HTTP调试开关。

源码根 `npm run test:contract:ui` 需要本机Edge和Playwright，可通过 `RENTVERITY_PLAYWRIGHT_PATH` 指定模块路径；先构建前后端，保持3001/4173端口空闲。故障通过独立测试子进程IPC注入，另执行真实模型与FC/聊天/地图只读回归。`npm run smoke:contract-memory` 使用相同普通/9MiB PDF、每次独立后端进程、每条件两次真实模型测量，需要本机 `server/.private/baseline-81d8f44` 的旧构建快照；旧版超限的大文件不作基线。完整复现、联合边界、原始记录和限制见[合同验收报告](../docs/contract-large-reliability-2026-11-02.md)。

`npm run smoke:assistant` 显式多次调用真实模型，覆盖缺城市、自动检索、跟进预算、流式问答、严格无结果与越界/合同隔离，并只读查业务库。逐次输出阶段及最终调用计数，不打印密钥/完整会话；次数随是否有匹配而变化。需要本项目 Key 和已升级数据库，固定用例不等于准确率测评。

`npm run smoke:assistant-reliability` 通过完整应用的 HTTP 登录/Cookie/CSRF/SSE 完成40轮真实 DeepSeek 参与的合成对话，分别计用户轮数、模型调用、仓库查询和 SELECT 数量，禁止写库；可用 `-- --cases=S01,S12,C03,Q01` 定向手动复测，多个 M 用例须同时包含 M01—M05。测试账号由 `RENTVERITY_TEST_USER/RENTVERITY_TEST_PASSWORD` 提供，或使用本机外层账号记录（不提交密码）。工具/正文都调用真实模型，错误不自动网络重试。报告写忽略的 `.codex_tmp/assistant-reliability-real-*.json`；这里保存的是显式测试的合成会话，生产审计日志不保存完整会话。浏览器回归在源码根运行 `npm run test:assistant:ui`，复现步骤和本轮结果见[验收报告](../docs/assistant-reliability-2026-11-02.md)。

接口失败带稳定 `code`，例如 `FILE_TYPE`、`PDF_NO_TEXT`、`AI_NOT_CONFIGURED`、`AI_INVALID_JSON`、`AI_INVALID_SCHEMA`、`AI_TIMEOUT`；不会向前端透出模型请求头、密钥或未校验的结果。

协议参考：[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[PDF.js 示例](https://mozilla.github.io/pdf.js/examples/)。
