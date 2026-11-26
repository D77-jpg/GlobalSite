# S24 AI 底座解耦、Worker 分道并发与实时进度流

本阶段只修改 GlobalSite，分支 `feat/s24-ai-worker-foundation`，不修改 GlobalCRM 或其契约。

## 1. 背景与解决的问题

1. **AI 服务商被锁死**：此前生产环境只允许 `https://api.openai.com/v1`，无法直接接入 OpenRouter、DeepSeek、Google Gemini OpenAI 兼容接口、DashScope、SiliconFlow 或合规自建 HTTPS 网关；单模型配置也无法区分主力写作模型与视觉审查模型。
2. **生图服务硬编码第三方中转**：`image-studio.service.ts` 与前端写死了 `https://www.codex789.com/v1` 及非标准模型枚举。
3. **Worker 全局单任务串行阻塞**：长耗时 `site.agent` / `site.build` 会阻塞验证邮件、询盘通知与 CRM 同步。
4. **高频 2 秒轮询**：任务执行期前端持续轮询既增加 429 限流压力，又无法即时反馈步骤切换。

## 2. 关键变更

- **统一安全 AI 目标校验 (`server/src/services/ai-target.ts`)**：
  - 放开经 `publicUrl()` SSRF 校验的公开 HTTPS OpenAI 兼容端点（禁止私网 IP、IP 字面量、保留 TLD、路径穿越与重定向），支持可选环境变量 `AI_ALLOWED_HOSTS` 严格域名白名单。
  - 保留非生产精确 `AI_LOCAL_BASE_URL` 例外（生产禁用）。
  - `aiFetch` 统一覆盖 `/chat/completions` 与 `/images/generations`。
- **可选专用视觉模型 (`AgentAiProvider.visionModelName`)**：
  - 勾选 `supportsVision` 且存在图片输入时，优先使用 `visionModelName`，留空回退主力模型 `modelName`。
  - 管理台 `/ai` 页面取消 `baseUrl` 只读，提供常用服务商一键预设。
- **可配置生图服务 (`server/src/services/image-studio.service.ts`)**：
  - 移除 `codex789.com` 硬编码与固定模型枚举；允许管理员配置 `baseUrl`、`model`、`mode`（`auto` / `images` / `chat`）与加密 `apiKey`（保留不重填密钥即可更新参数、空密钥断开）。
- **Worker 快/重双车道并发 (`server/src/background/runtime.ts`)**：
  - **Fast Lane**（`mail`、`inquiry.*`、`crm.*`）与 **Heavy Lane**（`site.agent`、`site.build`、`site.deploy`、`catalog.*`）独立领取并发执行，默认并发各 2（`WORKER_FAST_CONCURRENCY` / `WORKER_HEAVY_CONCURRENCY`）。
  - 保持 `claimTask()` / `tick()` 向后兼容，所有租约、owner、fencingToken 与站点活动锁保持不变。
- **实时 SSE 任务进度 (`GET /api/v1/sites/:id/agent-runs/stream`)**：
  - 保持 Cookie 会话鉴权、组织隔离与循环内实时会话/成员复查（注销或撤销成员立即断开）。
  - 前端 `useAgentRuns` 首页优先走 `EventSource` 实时接收更新，异常时自动降级轮询。

## 3. 兼容性与安全边界

- 无需数据库迁移；新增 `visionModelName`、`mode` 为可选字段。
- 零幻觉事实门禁、用量预留/结算、租户隔离、严格 CSP（无内联样式）全部保持不变。
