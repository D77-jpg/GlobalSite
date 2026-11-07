# GlobalSite 协作规则

## 当前阶段与仓库边界

- 本仓库 D:/Trade/genesis/GlobalSite，当前 S8–S11 B2B 建站与 Agent 质量闭环；S1 的“仅文档”限制为历史任务，已由后续功能任务明确授权取代。
- 每条命令、编辑和 git 操作前确认工作目录属于本仓库。GlobalCRM 当前路径 D:/Trade/genesis/CRM/GlobalCRM，J1 明确双仓分别授权，其他本站任务只读参考；废弃旧目录禁止读取或修改。
- 本次分支 feat/s8-s11-b2b-agent。后续用 feat/<任务编号>-<简述>，不直接推 main。两仓独立分支/提交/PR，不混仓。
- GlobalSite 仅连接自己的 globalsite 数据库；CRM 只能通过 Integration API，不能 import/npm link 对方代码。复制须保留源路径、源 commit 和改造说明并补测试。

## 契约和架构

- 唯一 CRM 契约：GlobalCRM docs/integration/integration-v1.openapi.yaml 和 globalsite-对接设计.md；本站不复制维护。
- 本站私有基础 API：docs/api/foundation.openapi.yaml；请求与响应变化先更新本站契约再实现、更新真实 HTTP 契约测试。
- CRM 接口变化必须在明确双仓授权任务中按“CRM 契约→CRM 实现→本站调用”推进；发现不一致停止受影响工作并汇报。
- GS-D01：已获用户同意登记旧客户状态/报价查询来源参数差异，MVP 不调用。C1–C3 已实现；C4 未实现草案不能当成已实现能力。
- 栈固定 Node >=22.23.4（S5 Astro 安全版本要求）、Express 4、TS、Mongoose 8、zod；React 18/Vite/Tailwind/router6/react-hook-form；node:test+tsx。不升级无关依赖。
- 所有模型注册 tenant 插件。User/Organization/Migration/RateLimit 为受限 identity 模式；Membership/Session/AuthToken 只允许有约束的身份查找；其他组织业务必须有 organizationId。禁止业务中使用 Model.collection 或原始驱动绕过；迁移、测试清理例外需明确。
- 查询在 AsyncLocalStorage 上下文内执行；不要将未执行的 Mongoose Query 带出上下文。任务只在专用 scheduler 上下文领取，执行恢复指定组织，所有完成/续租必须含 owner+fencingToken。
- api 和 worker 使用同一主密钥与独立数据库；S5 builder/发布独立任务；CRM 调用在独立 crm.\* Worker 任务执行。

## 安全与交付

- 不记录密码、token、验证码、重置链接、邮件正文、邮箱、AI 密钥；错误日志仅记录 requestId/固定事件码。开发邮件只记录通知编号，通过短期能力链接查看，生产禁用。
- 写请求检查精确 Origin 和会话绑定 CSRF。刷新轮换、旧令牌重放吊销、authVersion、当前 Membership 不能删去。新增鉴权路径必须补越权与重放测试。
- 新增配置写 .env.example 与 production.env.example；可选 SMTP/AI 未配置时降级，不能导致核心启动失败。
- 前端文案 zh/en；不要在产品 UI 暴露实现细节。密码/密钥禁止 localStorage；语言设置可存 localStorage。
- 不提交 .env、storage、node_modules、dist、.dsh、测试截图/缓存或真实数据。不要删除其他项目文件/卷/进程；清理前核对绝对路径。
- 完成 npm run typecheck、npm run build、npm run lint、npm test；前端/鉴权改动跑 Compose+test:e2e，依赖改动跑生产依赖审计。CI 包含 Gitleaks。
- 开始前阅读相关代码/文档并简述计划；结束更新文档和本文件，如实汇报未跑/失败/剩余风险，按用户要求的八项格式交付。

## S3 维护约束

- 产品/资料/事实/导入/AI 提取/旧站读取的实际行为见 docs/design/S3-产品与事实.md；本站新 API 先更新 foundation.openapi.yaml，再更新真实 HTTP 请求/响应测试。
- 所有候选保持待确认；只有管理员可确认/驳回。编辑事实撤回确认，产品变化撤回产品来源事实；修订/审计须同事务。来源 ID 与文件引用必须校验本组织。
- Excel 先预览/映射再确认；保留物理行号与错误报告，禁止宏/外链/公式，不能覆盖既有 SKU。任务逐行恢复，每次写入都校验租约及发起人当前权限。
- 旧站每次连接/跳转都解析并固定公开 IPv4，保持证书校验与 robots 限制；不得加 Cookie、系统代理、绕过 WAF 或执行网站脚本。
- AI 仅用组织配置模型，必须显式同意；文字候选需逐字证据，图片标未核对。未知调用用量保留预留，已保存结果恢复不得重复付费请求。
- 新图片及缩略/WebP 一并计量，旧文件不启动重写；保留本地持久卷。开发/测试不得删除现有用户或真实数据卷。
- 已获用户持续授权：完成后创建 PR，CI 全绿且无冲突时直接合并；不直接推送 main。

- CI 浏览器作业固定 ubuntu-24.04，匹配锁定的 Playwright 1.56；不要改回未验证的 ubuntu-latest。

## S4 维护约束

- S4 行为见 docs/design/S4-Agent与审核.md；本站 Agent/UI API 以 foundation.openapi.yaml 为准。CRM 本阶段无修改/调用。
- site.agent 的站点+步骤活动锁、Task 租约和派发代次必须同时成立；content/rewrite 共用锁。保留冻结输入、逐页结果先存再结算、已完成页恢复幂等、未知用量不重复调用。
- 数字/认证/年份/产能必须引用匹配的当前 confirmed 事实；API 审批和 requirePublishableSite 都必须重新校验。正文只接受文本/白名单区块，不能执行生成的 HTML/脚本。
- 规划、站点、内容或事实变更撤回批准；后续 builder/发布必须执行时复查，不把 readiness 查询当永久许可。S4 无实际发布端点。
- 不配置真实 AI 密钥或发起付费验证；优先模拟服务。浏览器回归触发 429 时遵守 Retry-After，不提高限流门槛；可使用独立临时 Compose 项目，保留真实数据卷。

## S5 维护约束

- 实现与恢复说明见 docs/design/S5-构建与发布.md；本站契约增加构建/发布 API 和 publishes 计量，CRM 无变化。
- Node 最低22.23.4，Astro7.4.5、Lighthouse13.6.0；不回退引入高风险漏洞的旧构建依赖。
- builder 只编译可信 Astro 路由和转义后的冻结数据；独立子进程、环境白名单、禁网络、堆512MiB/90秒。缓存写本任务目录，不写共享依赖；不引入用户代码/插件。
- 版本不可变，引用事实必须仍confirmed且revision匹配；新发布还要求当前页批准hash，回滚只用曾live原始zip，不重建。HTML/图片/manifest散列与HTTPS核验不能省略。
- 发布活动期间禁止编辑站点/地图/页面/审核/相关事实及来源；事务写Site与Fact锁防并发。所有任务状态提交必须有owner/fence/有效租约。
- Cloudflare Token 组织+站点绑定AES-GCM；响应不含秘密，审计只记录动作。远端POST前持久记录attemptedAt，模糊结果只查唯一标记，禁止盲目重发或猜测解锁。允许同目标替换过期Token并管理员核对。
- 未配置Cloudflare仍可zip/登录预览。预览全部noindex/private/no-store，正式文件不继承预览限制；S5 历史禁用表单由 S6 显式审核/启用后的版本取代。
- 完成常规检查、完整test:e2e、test:quality；三个模板HTML校验与移动Lighthouse性能/SEO均须>=90，报告附环境/局限；无真实Token时如实标注云流程为模拟。

## S6 维护约束

- 实现见 docs/design/S6-询盘与通知.md；公开接口以 inquiry-gateway.openapi.yaml 为准，私有接口仍以 foundation.openapi.yaml 为准，CRM 无改动/调用。
- 网关必须保留独立 Origin/CORS、IP/站点限流、大小/附件限制、Turnstile 验证；受限 publicId 查找只允许路由元数据，随后恢复组织上下文，不可绕过 tenant 插件。
- 先事务存档+任务+计量再返回成功；submissionId 并发幂等，邮箱窗口仅归组不丢弃。询盘数只统计，不能用套餐拦截；附件仍受存储容量限制。
- 访客内容/来源/备注/附件与 AI 结果加密；禁止日志记录原始 IP、邮箱、正文、附件名或签名预览授权。邮件只给登录详情链接。
- AI 垃圾识别默认关、仅组织模型；脱敏留言也需隐私说明。结果先存再计费，未知调用不重复；规则和通知不能因 AI 配置/额度失效。
- 通知出站先记录 attemptedAt；未知 SMTP 结果停重试，已知失败可退避/人工重试；任务正在运行不能重置。所有异步提交仍需租约 fence。
- 隐私政策默认模板，必须运营审核后启用表单；只导出显式审核的 confirmed 公司事实并纳入版本门禁。Cookie 选择按站点隔离，拒绝可选存储不影响提交。
- 开启询盘的版本发布前必须验证公网 HTTPS 网关；原 zip/预览降级可用。手工 zip 主机需后续域名验证机制，不能直接放宽 CORS。

## J1 / S7 维护约束

- 见 docs/design/S7-GlobalCRM连接.md；CRM 唯一契约仍在 CRM 仓库，本站测试夹具为固定提交逐字快照，只用于验证，不作第二份权威文档。
- CRM 精确来源白名单、固定公开 DNS/IP、无重定向、超时/体积限制、加密凭证及 connection generation/I/O lease/Task fence 必须同时保留；本地例外仅非生产显式 loopback。
- 同步先落盘再推进，远端更新进候选；接受才替换，撤销来源撤回确认并阻止新构建/发布。禁止导出临时 URL、覆盖人工事实或旧投递改目标。
- 询盘冻结内容与稳定幂等键，网络失败最多八次；鉴权/契约错误暂停，断开终止新网络请求。CRM 异常不能影响公开存档。
- 新隐私快照 s7-v1 才可推送；旧版询盘禁止重试绕过。无外部服务凭证的联调使用隔离实例、虚构账号、人工内容，不配置真实 AI/SMTP/云发布。
- J1 验收另运行 e2e/j1-connect.spec.ts，两应用独立进程/数据库，只通过 HTTP 连接；一次性凭证弹窗关闭后才截图，凭证禁止日志/浏览器存储。

- 本地 AI 仅允许非生产 AI_LOCAL_BASE_URL 指定的精确 /v1，限定 loopback 或 host.docker.internal；固定解析IP连接且禁重定向。不放宽旧站/CRM SSRF，真实密钥仅通过组织设置加密保存。

- 本地模型“测试连接成功”不等于 Agent 成功；研究和内容必须显式下达任务并通过真实 Worker 验证。已知格式失败须计费后用新 operationId 有限重试；未知结果不可清除 operationId 或释放预留。不得以手工生成站点替代 Agent 验收。

## 品牌设计与技能

- 设计规则位于 server/agent-skills/brand-site.md，外部技能的锁定版本与许可见 sources.json 和 vendor/。Worker 仅加载审核后的本地规范并冻结到新 AgentRun，不远程加载/执行技能脚本，不采用第三方部署、表单或凭证流程。
- 页面 presentation 独立于 SEO；公开 headline/summary/navigationLabel/primaryActionLabel 同样引用 page.refs 执行事实校验，designNotes 仅后台。所有展示变更撤回审批并进入版本冻结；保留旧页面正文和旧版本字节。
- 静态构建仅使用白名单 visualStyle/heroLayout，不执行模型 HTML/CSS/JS。导航最多四个主要页面，移动菜单可键盘操作，字体随产物本地分发并保留许可。
- 发布验收须观察实际 Agent 页面，不把全绿性能/SEO指标当成视觉验收。至少检查 375/390、768、1440，记录真实预览截图；缺少商业事实只请求确认，不能用伪造证明填满页面。

## S8–S11 维护约束

- 见 docs/design/S8-S11-B2B建站.md。只有 GlobalSite 可修改；CRM 无新接口或依赖。buyerProfile 是私有建站指引，不是商业事实；缺口只由当前 confirmed 事实计算。
- 新区块 items 所有公开文字、引用、图片和下载文件必须验证本组织与当前修订。evidence/customization/case-study 必须有支持其文字的确认事实；下载 PDF 必须显式选择并随页面审批。删除引用资产、构建事实快照、审批锁均覆盖嵌套 items。
- B2B 主导航最多五个采购入口；旧站四项布局保持兼容。新可选字段不能重写旧产物；目录仅导出冻结且已审核的页面信息。
- 参考站最多三个，robots/SSRF/公开 IPv4 固定/无脚本/无 Cookie 沿用 public-web；只研究结构，不导入对方客户、产能、认证或参数。
- review 冻结页面、站点、产品、事实版本；截图在隔离浏览器只读取可信静态文件，禁止外网/下载/服务 Worker，有限时间/体积。截图私有同组织，稳定收据恢复，存储正常计量。
- 模型图片输入须组织管理员显式启用，且任务显式同意；默认不发送图像。无 AI 时仅浏览器检查并明确人工审查；不得宣称做了 AI 视觉审查。
- refine 必须使用未变更的已完成审查，每轮用户触发，保留租约 fence/幂等/已知用量结算/未知结果暂停；写入新草稿，不能批准或发布。商业发布必须确认采购必需资料，管理员确认当前截图报告，所有页面仍须批准；修改后旧质量确认失效。
- 询价清单只保存当前站点产品 ID 至 sessionStorage，不存身份资料；跨页回填已有公开网关，不绕过隐私审核、CORS、限流和附件校验。无 JS 时产品及内容仍可读。

- S8–S11 回归使用独立 Compose 项目/卷与测试 Origin，避免实际 AI 任务占用唯一 Worker 或测试撞到真实账号限流；429 遵守 Retry-After，禁止通过提高限流或清真实桶来跑绿测试。
