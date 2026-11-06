# J1 / S7 可选 GlobalCRM 连接

## 范围与契约

GlobalSite 可独立运行。只有配置并启用连接后，Worker 才通过 CRM Integration API 获取资料和投递询盘；两边无代码或数据库依赖。

唯一权威契约仍在 GlobalCRM：[Integration v1](https://github.com/D77-jpg/GlobalCRM/blob/4e4cca4cdc828396b62155ee46d5f4947b99992a/docs/integration/integration-v1.openapi.yaml) 与[对接设计](https://github.com/D77-jpg/GlobalCRM/blob/4e4cca4cdc828396b62155ee46d5f4947b99992a/docs/integration/globalsite-%E5%AF%B9%E6%8E%A5%E8%AE%BE%E8%AE%A1.md)。本站不重新定义 CRM 端点或 DTO。GS-D01 旧客户状态/报价差异仍不调用；C4 Webhook 未实现，成交结果使用已有 outcomes 轮询。

测试夹具 server/tests/fixtures/crm-integration-v1.openapi.yaml 是上述提交的逐字快照，只供契约验证，不参与运行或独立维护。SHA256：f07bda17a0a976197d77cf6ed844175a930d2860bc2734d212de4ca839973342。更新必须先更新 CRM 权威文件并通过冻结检查，再复制并更新测试固定散列。

本站新增私有 API 以 docs/api/foundation.openapi.yaml 的 /crm 路径及询盘 crm 字段为准；签名附件 API 单列 docs/api/crm-attachment-download.openapi.yaml。公开询盘成功响应不变。

## 连接和权限

组织管理员在 CRM 项目设置的“集成与连接”生成 GlobalSite 凭证，将 CRM 基址、项目 ID、一次性凭证填写到本站“连接 GlobalCRM”。凭证仅加密保存在服务端，响应、审计和浏览器持久存储均不包含明文；提交结束清空输入框。测试连接显示固定错误码对应的中英文提示，远端 401 不触发本站退出登录。

部署管理员配置 CRM_ALLOWED_ORIGINS 为精确来源列表（协议、主机、端口）。默认空值不允许出站，独立功能照常运行。生产只接受公开 HTTPS IPv4，固定解析结果、校验证书、禁止重定向和跨源凭证传播。CRM_ALLOW_LOCAL=true 仅在非生产并显式允许精确 loopback 来源时生效，不能开放任意内网。请求有总超时、响应体和图片大小上限。

连接保存发起管理员身份；每次任务复查成员管理员权限与组织状态。权限撤销后暂停，由现任管理员重新测试接管。active 连接不可直接改项目或基址；更换目标先断开。断开递增代次，停止后续网络调用、队列和签名附件访问；正在执行的请求最多等待当前租约排空，必要时返回 disconnecting。保留本地资料和原投递归属，不自动改投其他连接。

## 数据、索引与迁移

所有新增业务模型使用组织 tenant 插件；索引初始化由 j1-s7-crm-v1 迁移账本登记，api/worker 启动和 npm run migrate 均幂等执行。数据库仍为 globalsite，不触碰 CRM 数据库。不回填或改写旧产品、旧询盘及旧静态版本。

| 模型 | 主要数据 | 关键索引 |
|---|---|---|
| CrmConnection | 加密凭证、精确目标、CRM 项目、scope、状态、发起人、revision/generation、I/O 租约 | 组织+目标+项目唯一；组织 active 部分唯一 |
| CrmSyncState | 资源、游标、水位、批次上界、full、seenIds、任务代次、失败数、下次时间 | 组织+连接+资源唯一 |
| OutboundDelivery | 询盘、连接、稳定业务键、加密冻结请求、状态、尝试数、下次重试、CRM 结果 | 组织+连接+询盘唯一；组织+kind+幂等键唯一 |
| CrmImportedResource | 去掉临时 URL 的公开资料不可变副本、sha256、事实证据、撤销标记 | 组织+连接+类型+远端 ID+散列唯一 |
| CrmOutcome | 事件 ID、客户 ID、成交/流失、发生时间 | 组织+连接+事件 ID 唯一 |

Product 新增 crmSourceStatus 和 syncCandidate；externalRef 保留连接/远端稳定 ID/最后散列。Asset 的 crmImportKey 部分唯一索引防重存。SiteInquiry 的私有 crm 字段显示投递状态、客户链接和结果；附件及冻结请求沿用加密存储。

## 同步、冲突与来源撤销

Worker 每分钟检查调度：C1 资料约十五分钟增量，成交结果约五分钟；每天完整核对一次，也可手动完整核对。缺少可选 scope 显示未授权，不能把 403/404 当空数据。每页持久保存后推进游标，尾页以契约 syncUntil 减一秒作为下轮 updatedSince，避免毫秒边界遗漏；重复项按稳定 ID 和散列消除。只有明确指向 cursor 的校验错误才重置游标，重新完整核对。outcomes 空页保留原游标。

首次导入建立独立产品与候选事实，签名产品图片下载后清洗为本站 Asset，不保存远端临时 URL。产品更新进入待审核差异；采用更新才替换产品，并撤回相关已确认产品事实；忽略保留本地内容。公司、话术、知识摘要保存公开证据副本，所有事实仍需人工确认。

归档、撤销和完整核对发现的缺失项将来源标记不可用、撤回相关确认并审计。选择产品、页面审核、构建、导出和发布均复查，不能用已缓存版本绕过来源撤销。已发布远端网站不会自动删除，运营需审查并重新发布。正在构建/发布时尊重既有来源锁，任务重试。

## 询盘可靠投递与隐私

公开接口仍先存档再返回。S6 inquiry.process 在独立事务中建立投递任务，与通知邮件分开；CRM 不可用不影响访客成功响应。请求第一次发送前冻结并加密业务内容，连接+询盘生成稳定幂等键；重试只更新临时附件链接，业务字段和键保持不变。CRM 端另有业务询盘唯一键，超时后重发不重复创建客户。

429 遵守 Retry-After；网络/5xx 指数退避，最多八次尝试后失败；凭证、权限、契约或管理员身份问题暂停，校验和目标冲突需人工处理。人工重试复用原键与目标，不能把旧投递指向新项目。签名附件链接绑定组织、连接代次、询盘、附件及有效期，断开失效，独立限流。CRM 仍须显式配置本站附件精确来源；附件异步失败不影响主询盘。

新版隐私模板标记 j1-s7-v1，构建快照含 s7-v1 CRM 告知标记。旧版本询盘即使后来连接 CRM 也只保存在本站，提示重新构建；不能通过重试绕过旧告知。连接前不会批量自动补推，管理员仅可对具有新版告知的单条询盘显式推送。旧站须审阅新模板并重建，未来询盘才能投递。

成交结果按 CRM 客户 ID 关联，不声称是精确的单条询盘成交归因；按事件去重且不倒退较新结果。

## 界面

组织管理员连接页显示状态、scope、资源同步水位、最后错误、候选差异与投递记录；支持测试、断开、手动/完整同步和失败重试。只读及编辑成员可看授权询盘的 CRM 状态和来源证据，不能修改连接。界面中英文、移动端和错误聚焦延续现有组件。

## 验证与隔离联调

常规：npm run typecheck、npm run build、npm run lint、npm test。server/tests/crm.test.ts 使用独立临时 MongoDB 与模拟 CRM，校验权威快照请求响应、跨组织/角色、候选冲突、源撤销、断网补推、重复回放、额度/尝试数、断开、凭证错误及旧隐私门禁。

真实双系统演示使用双方 tests/start-j1-fixture.ts，各自临时副本集/存储。CRM 5091、GlobalSite 5092；无真实 AI、SMTP、Cloudflare 或用户数据。先分别 build，再分别从本仓库运行：

- CRM：GLOBALSITE_ATTACHMENT_ORIGINS=http://127.0.0.1:5092、GLOBALSITE_ALLOW_LOCAL=true，npm --prefix server run test:fixture:j1。
- GlobalSite：npx tsx server/tests/start-j1-fixture.ts。
- GlobalSite：E2E_BASE_URL=http://127.0.0.1:5092、J1_CRM_URL=http://127.0.0.1:5091，npx playwright test e2e/j1-connect.spec.ts。

端到端脚本通过标准会话 API 登录虚构 CRM 账号，然后在真实 CRM 后台生成一次性凭证；GlobalSite 注册/验证/登录、连接、同步、确认候选、人工准备并批准页面、Worker 构建预览、表单提交附件、CRM 客户询盘、附件下载、保存待审回复草稿。凭证仅保留测试进程内存，关闭秘密弹窗后才截图；关闭实例即清理本次临时数据库与存储。默认常规 E2E 不运行需要第二系统的 J1 场景；必须按上述独立执行。

## 限制

- C4 Webhook、批量历史询盘回填不在本次范围。
- 无真实 AI/SMTP/Cloudflare，演示采用人工内容与 CRM 安全回执草稿，未验证付费生成或真实发信/云发布。
- 签名图片要求 IPv4，未配置或下载失败保留明确错误，不自动公开私有路径。
- CRM 已接受询盘后，不因重复提交替换原附件 URL；过期下载失败在 CRM 显示失败，不回滚询盘。
- 原站点和已发布版本需运营重新审查来源及隐私模板；不是自动撤网或自动法律合规审查。

## 文件清单

- .env.example
- AGENTS.md
- README.md
- compose.yaml
- docs/api/crm-attachment-download.openapi.yaml
- docs/api/foundation.openapi.yaml
- docs/design/S7-GlobalCRM连接.md
- docs/operations/J1-运行与验收.md
- e2e/inquiries.spec.ts
- e2e/j1-connect.spec.ts
- production.env.example
- server/src/app.ts
- server/src/background/runtime.ts
- server/src/config.ts
- server/src/db.ts
- server/src/models/index.ts
- server/src/routes/crm.routes.ts
- server/src/services/catalog.service.ts
- server/src/services/crm-client.service.ts
- server/src/services/crm-connection.service.ts
- server/src/services/crm-delivery.service.ts
- server/src/services/crm-sync.service.ts
- server/src/services/crm-worker.service.ts
- server/src/services/inquiry-settings.service.ts
- server/src/services/inquiry-template.service.ts
- server/src/services/inquiry-worker.service.ts
- server/src/services/inquiry.service.ts
- server/src/services/publishing.service.ts
- server/src/services/sites.service.ts
- server/src/services/storage.service.ts
- server/tests/crm.test.ts
- server/tests/fixtures/crm-integration-v1.openapi.yaml
- server/tests/start-j1-fixture.ts
- web/src/crm-i18n.ts
- web/src/crm.css
- web/src/crm.tsx
- web/src/i18n.ts
- web/src/inquiries.tsx
- web/src/main.tsx
- web/src/navigation.ts
- web/src/publishing-i18n.ts
- web/src/sites-i18n.ts
- web/src/style.css
- web/tests/crm.test.ts
