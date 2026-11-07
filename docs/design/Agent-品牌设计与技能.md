# Agent 品牌设计与技能

本阶段仅 GlobalSite；GlobalCRM 无改动。目标是让产品内的 Agent 生成可审核的品牌文案和有意图的展示数据，而不是由开发人员手工改写某个演示站。

## 技能来源与使用边界

锁定版本和许可证见 server/agent-skills/sources.json，原始只读 Markdown 快照和许可在 vendor/：

- coreyhaines31/marketingskills：copywriting、CRO（MIT）。
- haoyiyin/instant-site：设计先行、静态输出、图像计划与响应式检查（MIT）。
- anthropics/skills/frontend-design：受众相关的视觉方向、类型层级、首屏构图与批评（Apache-2.0）。

GlobalSite 加载自行审核、适配 JSON 架构的 brand-site.md；不会把第三方所有指令直接变成系统权限，不运行其脚本，也不切换至 FormSubmit/Wrangler/外部状态文件。新 AgentRun 冻结技能版本、散列与指导文本。资料值始终不可信；只允许安全区块、已确认事实、人工确认/审核和现有 Worker。可选 AI 不配置时仍可管理资料。

## 数据和契约

本站唯一私有 API 定义 foundation.openapi.yaml 新增可选 SitePresentation，沿用 /pages 创建/读取/编辑，不新增 CRM 接口、scope 或服务凭证。

presentation 包含 navigationLabel、headline、summary、primaryActionLabel、visualStyle（organic/industrial/minimal）、heroLayout（split/stacked）、designNotes。公开文字与 SEO 共用页 refs 并重新执行事实校验；设计说明仅后台、不写入 HTML。展示修改属于页面修订，撤回批准，快照和不可变版本包含该修订。旧页面省略该字段即可，旧正文保留，旧产物不重写。无索引/库名/集合名/环境变量变化，无需迁移。

## Agent 与渲染职责

Agent 根据受众、产品和当前证据生成短导航名称、独立首屏标题、简短介绍、行动按钮、风格与设计理由；系统不硬编码任何演示品牌。一般场景与品类创意文案可以使用，具体材料、参数、性能、认证、产能、客户、价格和交期仍须确认事实。缺失详情保留安全占位，渲染为集中信息请求，避免首屏被后台状态说明占据。

渲染器只解释白名单数据：图文分栏/上下首屏，精简主要导航、移动折叠菜单、产品图片卡片、FAQ、表格与询盘。产品名称、图片关联在构建时冻结；额外产品图片从本组织选用产品加载，最多每种产品两张，不从实时外部地址取图。字体与许可放入产物，无 CDN 依赖。未开启的询盘表单收在预览详情中，启用后的接口/CORS/反垃圾/同意不变。隐私选择保留，面板收窄。

单页重新生成复用现有 pageKey 契约，减少只改首页时重做全部页面。内容/重写请求分别使用有限输出预算（16384/2048 tokens）；用 UTF-8 消息字节上界、输出 token 上限和协议余量预留，按返回实际用量结算。截断只记录固定反馈码，已知失败计量后有限重试；完整 JSON 代码围栏可去除后继续严格结构与事实校验；不改变套餐上限，不释放未知结果预留。

## 验证

必须跑根 typecheck/build/lint/test、浏览器 E2E、test:quality。验证新字段真实 HTTP 往返、跨组织不可见、事实门禁、编辑撤回批准、技能冻结、公开文本转义、短导航和独立首屏；旧产物不可变/回滚原样的测试保持通过。

质量脚本对三模板执行完整 HTML 校验、移动 Lighthouse 性能/SEO >=90，检查 375/768/1440 无横向溢出；真实品牌预览另外在桌面/手机观察，不能以合成测试站指标代替审美判断。演示图是 AI 概念图，不能作为产品参数或工厂实拍证据。

## 本地验收记录（2026-11-07）

- 根 typecheck、build、lint、test 通过；server 97 项、web 8 项。
- test:e2e：7 通过；需要另启 GlobalCRM 的 J1 用例跳过，本阶段没有跨仓联调或修改 CRM。
- test:quality：machinery / building-hardware / packaging-bags 均 HTML valid、移动 Lighthouse 性能 100 / SEO 100；这些是合成测试站分数，不代表真实演示站跑分。
- 真实组织配置的本地 cn:deepseek-v4.1-flash 经 GlobalSite Worker 生成 PurrNest 首页：最终任务一次成功、60.1 秒、13031 tokens；人审批准后由构建任务产出第 3 版。此前因输出空间不足的已知失败仍正常计量，没有重置额度。
- 真实预览在 375 / 390 / 768 / 1440 宽度无横向溢出；6 张图片加载正常；主导航 4 项，手机菜单可展开；主按钮跳至产品区；预览 noindex,nofollow。电脑/手机截图保存为本地验收产物，不提交用户数据。
- 本次实际重生成首页，原有详情页内容保留；统一渲染改进会用于新构建，旧产物不变。图片先作为 AI 概念图上传资料库并关联产品，由 Agent 选用；本阶段未实现产品内自动生图，也未对外发布商业站点。产品参数、资质、公司资料仍需人工补充确认。
