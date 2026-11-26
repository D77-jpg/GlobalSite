# S36 平台统一 AI 服务与套餐额度（方案草案）

> 决策（2026-11-26）：正式上线时 AI 文本与图片服务由平台统一提供，费用打包进套餐；客户只看到"AI 额度"，不接触模型、密钥和 Token。
> 实施时机：等 S35 收尾任务（规格表过滤、未知用量自动兜底）完成并通过测试后再开始，避免同时修改 `site-agent-provider.service.ts`。

## 现状（代码核实）

- 每个组织在 AI 设置里自填文本模型（`AgentAiProvider name: "default"`）和图片服务（`name: "images"`），密钥按组织加密入库，费用由客户自己的服务商账户承担。
- 套餐已有额度：`server/src/constants/plans.ts` 中 trial / starter / growth 分别有 `ai_tokens`（20 万 / 200 万 / 1000 万）和 `images`（10 / 100 / 500）等，计费走 `reserve/settle`，按组织按月统计。
- 所以"按套餐计费"的计量基础已经具备，缺的是"平台级服务商"和"面向客户的额度表达"。

## 方案

### 1. 平台级服务商配置（运维配置，不进数据库、不进代码）
- 新增环境变量：`PLATFORM_AI_BASE_URL`、`PLATFORM_AI_API_KEY`、`PLATFORM_AI_MODEL`、`PLATFORM_AI_VISION_MODEL`（可空）、`PLATFORM_IMAGE_BASE_URL`、`PLATFORM_IMAGE_API_KEY`、`PLATFORM_IMAGE_MODEL`、`PLATFORM_IMAGE_MODE`。写入 `.env.example` / `production.env.example`（只写变量名和说明，不写真实值）；生产用密钥管理注入。
- 统一解析函数 `resolveTextProvider()` / `resolveImageProvider()`：平台配置存在时一律使用平台服务；仍走 `aiBase` 的 SSRF 校验与 `AI_ALLOWED_HOSTS`。
- 组织自带密钥（BYOK）：本期不对客户开放。已有组织配置保留在库中但不再使用；代码保留读取路径，供将来"大客户自带密钥"选项（默认关闭的开关 `ALLOW_ORG_AI_KEYS=false`）。

### 2. 客户界面
- 组织设置里的"AI 设置 / AI 图片设置"页对普通组织隐藏，改为只读的"AI 服务：由平台提供"说明。
- 用量页按套餐显示：本月 AI 生成额度已用 X%、AI 图片已用 N / 上限，下次重置日期，以及"升级套餐"入口。不显示 Token、模型名、服务商。
- 额度不足时：任务暂停并提示"本月 AI 额度不足，请升级套餐或下月再试"；已有的 `QUOTA_EXCEEDED` 暂停逻辑沿用。

### 3. 额度换算（业务待定）
- 内部仍按 Token 精确计费；对外可选两种表达：
  - A. 百分比（默认）：已用 / 套餐 `ai_tokens`。
  - B. "生成次数"估算：按典型整站消耗折算，例如"约可生成 N 套完整网站"。需要先用真实 Verona 数据统计一次整站的平均消耗再定。
- 套餐额度与价格由业务决定；建议先在 Verona 和 1–2 个新行业站跑通后，按实际平均消耗校准 starter / growth 的额度。

### 4. 平台运营侧
- 平台后台（非客户可见）汇总：各组织每月实际 Token / 图片数、未知用量兜底次数（S35 的 `absorbed` 记录）、按服务商单价估算的成本，便于对账和定价。
- 告警：单组织当月消耗超过套餐 80% 时提示升级；平台总成本超过阈值时告警。

### 5. 安全
- 平台密钥只在环境变量或密钥管理中，日志与错误不输出；聊天、代码、测试、文档中都不出现真实密钥。
- 早前在聊天中明文出现过的 synapsea 密钥视为已泄露，上线前在服务商后台轮换，新密钥只放进 `PLATFORM_*_API_KEY`。

## 已决定（2026-11-26）
1. 对外额度用**百分比**展示（"本月 AI 额度已用 X%"），图片按"已用 N / 上限"。不做"约可生成 N 套网站"换算。
2. 套餐额度与价格：**先沿用 `plans.ts` 现有额度**，Verona 与 1–2 个新行业站跑通后，按真实整站平均消耗再校准 starter / growth 的额度和定价。
3. 大客户自带密钥：本期不开放，保留默认关闭的 `ALLOW_ORG_AI_KEYS` 开关。

## 校准所需数据（跑真实站时记录）
- 每套整站（首页 + 详情 + 扩展页）的文本额度消耗、图片张数、Logo 生成次数。
- 未知用量兜底次数与重试次数。
- 按服务商单价折算的单站成本，用于反推套餐额度和价格。

## 验收
- 未配置任何组织 AI 设置的新组织，能直接完成建站全流程（文本 + 配图 + Logo）。
- 客户界面全程不出现 Token、模型名、服务商、密钥。
- 额度耗尽时任务暂停且提示升级；平台后台能看到每个组织的实际消耗与兜底次数。

## 实施记录（2026-11-26，未经编译与测试）

> 本节记录 S36 第一版实现。所有改动均未在本机运行 typecheck / lint / test / build，需按文末命令验证。

### 1. 平台级服务商解析
- `server/src/config.ts`：新增 `platformAiConfig(env)`，调用时读取环境变量（与 `ai-target.ts` 一致，便于测试与重启生效）。文本服务需 `PLATFORM_AI_BASE_URL` + `PLATFORM_AI_API_KEY` + `PLATFORM_AI_MODEL` 三项齐全，图片服务需 `PLATFORM_IMAGE_BASE_URL` + `PLATFORM_IMAGE_API_KEY` + `PLATFORM_IMAGE_MODEL` 三项齐全；缺项、超长、非法取值（输出模式、图片模式、升级链接）被忽略，启动时只输出固定事件 `platform_ai_config_invalid` 与变量名，绝不输出值。
- 新增 `server/src/services/ai-provider-resolve.ts`：
  - `providerSource(kind)`：`platform` / `organization` / `none` 的纯函数优先级。
  - `resolveTextProvider()` / `requireTextProvider()`（后者沿用 `AI_UNCONFIGURED`）、`resolveImageProvider()`、`imageProviderAvailable(session?)`。
  - 返回调用方所需的同一形状：`baseUrl`、`modelName`、`visionModelName`、`supportsVision`、`outputMode`、`taskModels`、`temperatureByTask`（图片为 `mode`），以及 `managed` 与唯一取密钥方法 `apiKey()`。
  - `settingsManaged(kind)`：组织 AI 设置是否只读（平台托管，或生产环境且未允许组织密钥）。
- 调用点改为经解析模块取服务商与密钥：`site-agent-provider.service.ts`（`callSiteAgent`，含 Agent 全部步骤与询盘垃圾识别）、`fact-ai.service.ts`、`fact-suggest.service.ts`、`ai.service.ts`（测试连接）、`image-studio.service.ts`（`generateImage`，含自动配图与 Logo）、`site-media.service.ts`（Logo 入队与状态）、`agents/auto-images.ts`、`agents/steps/process.ts`（审查模式与是否附图）。`resolveModelForTask` / `resolveTaskRouteKey` 与全部导出签名不变。
- 计费不变：仍在当前组织上下文 `reserve/settle`，operationId 规则不变；S35 未知用量自动吸收、事实门禁、审批、发布门禁和租户隔离均未改动。
- 平台地址在调用点照常经过 `aiBase()` / `aiFetch()`（SSRF、禁重定向、`AI_ALLOWED_HOSTS`）。`compose.yaml` 同时补上了此前缺失的 `AI_ALLOWED_HOSTS` 透传，生产可设为 `synapsea.co`。
- 平台托管时 `callSiteAgent` 不再把模型名写入 `AgentResult.modelName`，因此 Agent 记录与 `diagnostics.modelsUsed` 不含平台模型名；组织模式不变。

### 2. 优先级规则
1. 平台配置完整 → 平台服务（`managed: true`），组织配置被忽略（文本与图片分别判断）。
2. 否则 `ALLOW_ORG_AI_KEYS=true` 或 `NODE_ENV !== "production"` → 组织自己的加密配置（本地开发、现有测试、当前 Verona Compose 环境默认 `NODE_ENV=development`，行为不变）。
3. 否则 → 未配置：文本 `AI_UNCONFIGURED`，图片 `IMAGE_PROVIDER_MISSING`，客户看到现有业务化提示。
- 平台视觉输入：仅当设置 `PLATFORM_AI_VISION_MODEL` 时 `supportsVision=true`（由平台运营者显式开启，取代组织管理员勾选）；任务层的 AI 同意与“结构/文字/视觉审查”标注规则不变。

### 3. 接口行为
- `GET /ai/provider`、`GET /assets/image-provider`：托管（含“生产且不允许组织密钥”）时返回 `{ managed: true, enabled, configured }`（`ManagedAiService`），不含模型名、地址、密钥；`enabled`/`configured` 表示平台服务是否可用。
- `PUT /ai/provider`、`POST /ai/provider/test`、`PUT /assets/image-provider`：托管时返回 `409 PLATFORM_MANAGED`，不写库、不预留额度、不调用服务商。
- 非托管时以上接口返回与 S36 之前完全相同（不追加 `managed` 字段）。
- `GET /usage` 追加 `resetsAt`（下一个 UTC 自然月 1 日，与 `usage.service` 的 `period` 一致）与 `upgradeUrl`（`PLATFORM_UPGRADE_URL`，仅接受 https / mailto，否则 `null`）。契约见 `docs/api/foundation.openapi.yaml`。

### 4. 客户界面
- AI 设置页（`web/src/main.tsx` 的 `AiPage`）：托管时隐藏服务商预设、模型、地址、密钥、路由与测试按钮，只显示“AI 服务由平台提供，按套餐额度计费”；平台未开通时显示“暂时未开通，请联系我们”。
- 资料库配图（`web/src/catalog.tsx` 的 `ImageStudio`）：托管时隐藏生图服务设置，显示“AI 配图由平台提供，按套餐的 AI 图片额度计费”，生成表单照常可用。
- 用量页：AI 额度仍为百分比；AI 图片显示“已用 N / 上限 张”；显示“本期额度将于 X 重置”；AI 或图片用量 ≥ 80% 时顶部提醒；底部“升级套餐”入口（有 `PLATFORM_UPGRADE_URL` 时为外链按钮，否则为“联系我们升级套餐”文案）。
- `QUOTA_EXCEEDED`：全局错误提示与任务中心均追加“升级套餐”入口（`/usage#upgrade`），S35 业务化文案不变。新增文案均为 zh/en，不含 Token、模型名、服务商、密钥（`web/tests/customer-copy.test.ts` 与新测试覆盖）。

### 5. 平台运营对账
- 纯函数：`server/src/services/ops-usage-report.ts`（周期解析、operationId → 运行归属、组织/站点聚合、成本估算、80% 与成本告警、表格格式化）。
- 命令：`server/src/scripts/ops-usage.ts`，`npm run ops:usage -- --period 2026-11 [--json]`（根目录）；镜像内 `node server/dist/scripts/ops-usage.js --period 2026-11`。
- 受限只读上下文：组织列表在既有 `runIdentity` 中读取（`Organization` 本就是 identity 模型）；其余所有查询在 `runWithTenant(<该组织>)` 中逐个组织执行，tenant 插件照常追加组织过滤。没有新增任何绕过、没有 `Model.collection`/原始驱动/aggregate、没有写入；连接不执行 `migrate()`，并关闭 `autoIndex`/`autoCreate`。
- 输出：每个组织的套餐、AI 用量与额度百分比、图片张数与上限、自动吸收次数与原因分布、成本估算（已知 + 吸收上限）；每个站点的文本用量、图片张数、Logo 图片数与 Logo 任务数、Agent 任务数、吸收次数；无法归属站点的用量（资料提取、询盘识别、测试连接、手动配图）单列为组织级。≥ 80% 的组织标 `[!]`，总成本超过 `PLATFORM_COST_ALERT` 标 `COST ALERT`。此输出仅供平台运营，可含原始用量单位，不含密钥、邮箱、提示词或模型输出。

### 6. 环境变量与默认值
| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PLATFORM_AI_BASE_URL` / `PLATFORM_AI_API_KEY` / `PLATFORM_AI_MODEL` | 空 | 三项齐全才启用平台文本服务 |
| `PLATFORM_AI_VISION_MODEL` | 空 | 设置后启用平台视觉输入 |
| `PLATFORM_AI_OUTPUT_MODE` | 空（= `json_object`） | `json_object` / `json_schema` |
| `PLATFORM_IMAGE_BASE_URL` / `PLATFORM_IMAGE_API_KEY` / `PLATFORM_IMAGE_MODEL` | 空 | 三项齐全才启用平台图片服务 |
| `PLATFORM_IMAGE_MODE` | `auto` | `auto` / `images` / `chat` |
| `ALLOW_ORG_AI_KEYS` | `false` | 生产仍允许组织自带密钥（本期不对客户开放） |
| `PLATFORM_UPGRADE_URL` | 空 | https / mailto 升级入口 |
| `PLATFORM_AI_PRICE_PER_MILLION` / `PLATFORM_IMAGE_PRICE` / `PLATFORM_COST_ALERT` | 空 | 仅 ops 对账估算与告警 |

已写入 `.env.example`、`production.env.example`、`compose.yaml`（只有变量名与安全默认值）。

### 7. 旧组织配置的处理
- 库中已有的 `AgentAiProvider`（`default` / `images`）不删除、不迁移、不改写。平台托管时被忽略，设置页只读；取消平台配置（非生产或 `ALLOW_ORG_AI_KEYS=true`）后自动恢复使用。
- 生产环境若既无平台配置也未允许组织密钥，即使组织曾保存密钥也不会再被使用。

### 8. 测试
- `server/tests/s36-platform-ai.test.ts`：优先级四种情形、不完整/非法配置、托管设置接口（不泄露模型/地址、409）、非托管行为不变、调用点 Authorization 来自环境变量且用量记在当前组织（文本、资料提取、图片）、取消平台后回到组织密钥、`/usage` 新字段、ops 汇总与格式化纯函数。
- `web/tests/s36-platform-ai.test.ts`：托管判定、80% 提醒、升级链接白名单、重置日期格式、托管文案不含模型/服务商/密钥/Token，AI 设置页托管分支位于表单之前。

### 9. 未验证项与风险
- 全部改动未运行 typecheck / lint / test / build / test:quality / e2e；类型细节（如 `runIdentity` 返回的 lean 类型、`Query.session()` 链式调用）以静态阅读为准。
- 本机根目录 `.env` 会被 `config.ts` 通过 dotenv 加载：若在其中填写 `PLATFORM_*`，`npm test` 中依赖组织配置的旧测试会进入托管模式而失败（新测试会自行清空）。平台密钥应只放在生产密钥管理中。
- 平台视觉输入改为由 `PLATFORM_AI_VISION_MODEL` 开启，不再有组织管理员的单独勾选；如需按组织关闭，需要后续再加开关。
- 询盘 AI 垃圾识别（S6，默认关）开启后会改用平台服务；隐私说明需相应更新为“平台提供的 AI 服务”。
- `ops:usage` 逐个组织顺序读取，组织很多时较慢；按 UsageRecord 全量读取当月 `ai_tokens`/`images` 记录。站点归属依赖现有 operationId 格式，格式变化需同步 `operationRef()`。
- 前端没有 DOM 级测试，托管分支通过源码与纯函数测试间接覆盖，需 e2e / 人工验收。
- 生产上线前的“新组织无需任何 AI 设置走完建站”验收尚未进行。
