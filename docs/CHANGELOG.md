# GlobalSite 演进与阶段归档（CHANGELOG）

本文档归档 GlobalSite 从 S2 基础底座到 S33 质量与体验优化的核心里程碑；最新协作约束与运行门禁以 [AGENTS.md](../AGENTS.md) 为准。

- **S33（Agent 质量、模块化重构与一键出站）**：拆分 `site-agents.service.ts` 至 `server/src/services/agents/**` 并开启核心链路 `no-explicit-any: error`；新增 `AgentAiProvider` 可选 `outputMode (json_object / json_schema)` + HTTP 400 无重复计费回退、按任务模型路由 `taskModels`、可选 `temperatureByTask` 与解析修复诊断；对齐 S32 视觉导演与生图光影；前端拆分 `web/src/sites.tsx` 至 `web/src/sites/**` 并清理 276 条历史冗余 CSS；新增 `/sites/new` 一键出站快速通道与 4 行业回归基准。详见 [S33 优化说明](design/S33-%E4%BC%98%E5%8C%96%E8%AF%B4%E6%98%8E.md)。
- **S32（多风格旗舰独立站渲染引擎）**：本地离线打包 4 套 SIL OFL 1.1 旗舰字体（`Cormorant Garamond`、`Plus Jakarta Sans`、`Space Grotesk`、`JetBrains Mono`），升级 9 套 WCAG AA 行业配色（含真暗黑 `obsidian`）、4 种首屏构图、无重叠 Cookie/询价栏与首屏字体预加载性能优化（移动端 Lighthouse 94–98 / SEO 100）。详见 [S32 设计](design/S32-%E6%97%97%E8%88%B0%E7%8B%AC%E7%AB%8B%E7%AB%99%E6%B8%B2%E6%9F%93%E5%BC%95%E6%93%8E.md)。
- **S29–S31（Velvet Obsidian 外贸视觉策略工作室）**：暗/亮双主题工作台、五屏重构（视觉策略工作室、结构蓝图画布、三栏页面精修、16:10 产品资产库、品牌知识事实库），严守 `style-src 'self'` CSP。详见 [S29](design/S29-%E6%9A%97%E9%BB%91%E6%97%97%E8%88%B0UI%E8%AE%BE%E8%AE%A1%E7%B3%BB%E7%BB%9F.md)、[S30](design/S30-%E5%A4%96%E8%B4%B8%E5%B7%A5%E4%BD%9C%E5%8F%B0%E4%BA%A7%E5%93%81%E9%87%8D%E6%9E%84.md)。
- **S24–S28（AI 底座、双车道并发、多语种与外贸增长）**：任意公开 HTTPS OpenAI 兼容接口 + SSRF 防护、fast/heavy 双车道 Worker、鉴权 SSE 进度流、8 语种（含阿拉伯语 RTL）、`gallery`/`metrics`/`certifications`/`showcase` 旗舰区块、分屏草稿预览、批量审批、可选 GA4/GTM/Pixel、自动回复、部署 Webhook 与 S3/R2 零依赖对象存储。
- **S15–S23（业务策略、成对设计提案与内容深度）**：自适应建站向导、业务策略与首页+代表详情成对设计提案、区块级艺术指导、单页拆分执行与受限 `jsonrepair` 修复、加密失败候选复用。
- **S7–S11（GlobalCRM 可选连接与 B2B 质量闭环）**：CRM 精确来源白名单与幂等投递、B2B 采购导航/询价清单/375-768-1440 截图审查与 `refine` 闭环。
- **S2–S6（独立站基础、产品事实库、Agent、构建发布与独立询盘）**：多租户隔离、账号与两步验证、Excel/旧站读取、零幻觉事实门禁、隔离 Astro 构建/预览/Cloudflare 发布、独立询盘网关与隐私合规。
