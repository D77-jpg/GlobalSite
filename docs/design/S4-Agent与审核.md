# S4 站点、Agent 与内容审核

本阶段仅修改 GlobalSite，分支 feat/s4-agents，基线为 S3 合并提交 275671c24848245a4d3a70a76d3423547f5c3cb2。CRM 无修改、无新调用；唯一 CRM 契约仍在 GlobalCRM 仓库。

## 工作流

1. 站点列表创建站点：名称、三种行业模板标识（机械设备/建材五金/包装箱包）、目标市场、英文、品牌色、组织私有 Logo、选用产品。
2. 可选启动资料访谈；问题围绕缺失企业/产品字段，回答仅写候选事实。到事实库核实并确认后再作为网站依据。
3. 研究 Agent 提出关键词、采购意图、聚类和站点地图。它没有实时搜索工具，不输出或宣称搜索量、竞争对手调查等实时研究证据。
4. 人工编辑地图的页面、名称、路径、层级、关键词及意图。可以拖拽，也可以用上移/下移按钮操作。管理员确认后才能生成内容。
5. 内容 Agent 可生成全部地图页面，API 也允许指定一个页面；按页持久化。未配置 AI 时可以手工建页面和编辑区块。
6. 编辑标题、meta、段落、规格表、FAQ 与图片 Alt，逐段选择确认事实；单段重写需显式同意发送资料。问题标红并指出待处理原因。
7. 管理员预览整页，再批准或驳回。编辑/新规划/事实撤回使批准失效。发布前检查必须全部通过；实际构建、导出和上线由后续发布任务实现。

站点名称同时用于英文预览品牌标题；包含数字或成立/认证等硬声明时，也须由页面 SEO 引用提供确认依据。管理台中文/英文与网站英文独立。

## 模型与迁移

所有新增模型经 entity→tenant 插件注册；不能按浏览器传入 organizationId 读写，外键须本组织拥有。Cookie/CSRF/Origin 与当前成员角色沿用 S2。

| 模型                 | 主要字段                                                                                                                                                      | 索引/关系                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Site                 | name/templateId/targetMarkets/language=en/brandColor/logoId/productIds/status/revision/lockVersion；plan/planRevision/confirmedPlanHash/planReviewedBy/At     | 组织+创建时间；Logo 指向 ready 图片，产品必须本组织未归档；站点数量按现有套餐限制           |
| SitePage             | siteId/nodeKey/path/retiredPath/type/productId/title/metaDescription/refs/revision/reviewStatus/approvedHash/reviewedBy/At/reviewReason/originRunId           | (组织,站点,nodeKey) 和 (组织,站点,path) 唯一；页面修改使用 CAS                              |
| SiteBlock            | siteId/pageId/key/type/heading/body/table/faq/assetId/alt/refs/order/revision                                                                                 | (组织,pageId,key) 唯一；站点/页面/排序；仅 text/specs/faq/image 白名单                      |
| AgentRun（扩展）     | kind=site.agent/siteId/step/lockKey/active/requestKey/requestHash/cancelRequested/inputSnapshot/inputSummary/steps/retryGeneration/tokens/elapsedMs/errorCode | active=true 的 (组织,站点,lockKey) 部分唯一；requestKey 部分唯一；S3 提取任务字段和行为保留 |
| Organization（扩展） | siteLock                                                                                                                                                      | 组织根事务锁，防并发创建/恢复站点超过套餐数                                                 |
| FactSheet（扩展）    | referenceVersion                                                                                                                                              | 审核事务锁，避免批准与撤回确认发生写偏斜                                                    |

AgentRun.steps 逐页/逐步骤保存 key、冻结输入的摘要和 hash、预期页面版本、status、attempts、output、pendingResult、operationId、startedAt、elapsedMs、tokens、errorCode、history。输入全量快照只在私有数据库保存，日志和 AuditLog 不包含提示词、正文、邮箱或密钥。运行详情返回可读摘要和步骤结果，不返回服务商密钥。

启动执行幂等迁移 s4-agents-v1，初始化新集合和部分唯一索引；保留现有用户、产品、事实、S3 任务与文件。数据库仍为 globalsite，无新环境变量、无依赖升级、无需手工搬迁。Logo 和区块引用中的图片不能被删除，关联时触碰引用锁与删除事务互斥。

## 队列、锁与恢复

| 阶段     | 行为                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| 入队     | 必须 Idempotency-Key；同键不同请求拒绝。冻结站点、产品与已确认事实及版本；事务创建 AgentRun+Task+审计                 |
| 同步触发 | 组织+站点+步骤 active 部分唯一；相同参数并发返回同一个运行。content 与 rewrite 共用 content 锁                        |
| 执行     | 独立 Worker；任务 owner+fencingToken+未过期租约，60 秒租约/20 秒心跳；每次业务提交再检查当前编辑权限                  |
| 每页     | 步骤开始记录独立计量 operationId；结果先持久化 pendingResult，再按实际 tokens 结算，再事务提交页面/区块和成功状态     |
| 恢复     | 已成功页跳过；已保存模型结果复用；请求已发出而结果未知时暂停，保留额度，不自动重复付费请求                            |
| 重试     | 明确 HTTP 429/5xx、非法结构有限重试，每步每轮最多三次，使用现有 Task 退避。手工重试开新派发代次，旧代次不能调用或提交 |
| 取消     | 排队/暂停任务即时结束；执行中的任务记录取消请求，等当前调用结束并处理已知计量后停止，结果不提交到页面                 |
| 超额     | QUOTA_EXCEEDED→paused，保留完成页和锁；额度恢复后从失败页继续。AI 未配置同样暂停，手工编辑仍可用                      |

每次执行和提交检查冻结的站点、规划、产品和确认事实版本。源资料或人工页面修改后，旧生成不能覆盖新内容；需要新运行取得最新输入。未知用量没有可恢复结果时，手工重试也拒绝，需管理员核查后另行处理；取消不会擅自释放可能已使用的额度。

同站点不同步骤可分别入队，但规划确认/修改和站点设置在存在活动任务时拒绝，防止并行覆盖；任务以单 Worker 顺序执行，可部署多个 Worker，租约与唯一索引仍约束同一步骤。

## 内容结构和事实门禁

内容不接受用户代码或任意 HTML。正文为文本；规格为 columns/rows；FAQ 为 question/answer/detail；图片只能引用组织的 ready Asset。预览通过固定模板转义输出 HTML，规格使用真正的 table。iframe 禁止脚本，预览 noindex；不会加载模型提供的脚本、远程图片或自定义组件。

产品页面要求 specs/material/application/certifications/oem/moq/samples/packaging 八个区块，涵盖规格范围、材质、应用、认证、OEM/ODM、MOQ、样品与交期、包装。没有确认资料时提示联系团队，不以产品草稿或模型常识补造硬数据。FAQ answer 为直接回答的 40–60 个英文单词，后续解释独立放 detail，校验短回答和常见空泛开头。

每个区块和 SEO 均有 factId+revision 引用。校验器扫描标题、meta、品牌标题、段落、表格、FAQ 与 Alt：

- 数字、全角数字和常见英文数字词需匹配已确认事实的值/单位；MOQ、交期、成立和产能语境额外检查事实类型。
- ISO、CE、FDA、REACH 等命名认证与泛称 certified 需要认证类事实；无关数字事实不能证明认证。
- 成立年份、产能声明必须有相应事实。产品事实只能用于本站选用产品，产品详情还须对应当前产品。
- 引用必须当前 confirmed 且 revision 相同；不存在、候选、已驳回、被修改的引用阻断。事实库的确认状态仍由人负责。
- 产品材质、应用、OEM/ODM、包装、认证、MOQ 与样品交期等段落的非占位内容，以及非数值规格行，也需匹配对应确认事实。
- 产品必要段落、规格表、FAQ 字数、图片和 Alt、英语内容检查产生待处理问题。问题不能通过“批准”绕过。

这是保守的确定性门禁，不是对任意自然语言真实性的完整证明；英文数字建议使用阿拉伯数字。特殊认证名、非数值营销背书、语义误导仍须人工审核。不能将“带引用”视为所有文字自动真实。

批准记录绑定页面内容、路径、站点 revision 与确认规划 hash。GET 页面和发布检查动态读取当前事实；事实确认撤回立即使后续检查失败。待处理问题或未批准页导致 publication-check 返回 409 SITE_NOT_READY。后续构建/发布必须在动作执行时再次调用 requirePublishableSite，不将一次查询结果当永久发布许可。

规划换网址/交换路径/移除页面时，确认事务保留旧草稿、释放旧路由并撤回批准；旧内容不作为当前地图发布。API 和界面显示预期公开路径，内部保留路径不对外展示。重新保存或生成后才能审核；不自动删除草稿。

## API 与权限

可执行定义为 [本站 OpenAPI](../api/foundation.openapi.yaml)，不重复复制 CRM 接口。本阶段新增：

- site-templates、sites 列表/创建/读取/编辑；
- 规划保存与管理员确认、选用资料读取；
- 站点运行列表/入队、运行详情/取消/重试、访谈回答；
- 当前地图页面列表/手工创建、页面编辑、预览、批准/驳回；
- readiness 和管理员 publication-check。

viewer 浏览；editor 维护、生成、重写和取消；admin 另有规划确认与整页审批。写操作沿用 Origin+CSRF；private,no-store。站点/规划/页面编辑带 revision。站点 JSON 上限 128 KiB、页面 512 KiB，认证与其他既有接口仍 32 KiB，原有限流保留。

MVP 一站最多 50 个地图页面、50 个选用产品；一次 AI 输入最多 200 条确认事实、120000 字节，输出缓冲最多 512 KiB。超大来源明确拒绝，不偷偷截断后宣称完成。手工页面验证只加载实际引用的事实，避免无关事实数量影响门禁。将来可增加资料选择与分批规划。

## 提供商与测试边界

复用组织现有加密 OpenAI 配置，保留管理员指定模型；无默认模型替换。JSON 模式不保证业务结构，服务端 zod 再校验并有限重试。按 usage.total_tokens 计量，未知网络/用量保留预留。参考 [OpenAI 官方结构化输出说明](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)。未配置 AI 不影响应用启动；本次未配置真实密钥或执行付费调用，供应商 HTTP 使用受控模拟验收。

三种行业模板目前为站点配置及内容规划选项、共享安全区块预览；完整静态主题、Astro builder、导出、Cloudflare 和域名发布由后续阶段实现。本阶段没有生成公开网站，也没有调用 GlobalCRM。

已有 Router 6 生产依赖两项 moderate 告警保持记录，未升级指定技术栈；安全审计 high/critical 门槛不降低。首次 UI 设计搜索返回与现有管理台不符的营销页/React 19 建议，未采用；保留 React 18 和现有绿色管理台，只应用已匹配的拖拽替代按钮及表单反馈规则。
