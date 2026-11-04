# GlobalSite
独立的 AI 建站与运营产品，面向 B2B 外贸企业：资料与产品 → 事实确认 → Agent 规划/英文网站 → 人工审核 → 发布 → 询盘管理。可独立销售，可选连接 GlobalCRM。

当前阶段 **S1 文档设计**，没有应用代码、依赖或可运行服务。不要运行不存在的安装/开发命令。

- [MVP 技术设计](docs/design/MVP-设计.md)：架构、模型、API、Agent、构建发布、安全、测试及 S2–S7 计划。
- [仓库协作规则](AGENTS.md)。
- CRM 唯一对接依据：[OpenAPI 草案](https://github.com/D77-jpg/GlobalCRM/blob/9930762be20908ec50513a2f2b723e1dcdd93ca1/docs/integration/integration-v1.openapi.yaml) 与[双方对接设计](https://github.com/D77-jpg/GlobalCRM/blob/9930762be20908ec50513a2f2b723e1dcdd93ca1/docs/integration/globalsite-%E5%AF%B9%E6%8E%A5%E8%AE%BE%E8%AE%A1.md)。本站不维护第二份 Integration API。

计划技术栈：Node >=20.19 / Express 4 / TypeScript / Mongoose 8 / zod；React 18 / Vite / Tailwind；独立 MongoDB 数据库 globalsite；Astro 静态构建与可选 Cloudflare Pages。详细选择与降级见设计文档。

本仓库不读取 GlobalCRM 数据库、不依赖其代码。后续分支 feat/<任务编号>-<简述>；S1 使用 docs/s1-design。S2 初始化工程后必须通过 npm run typecheck、npm run build、npm run lint、npm test。S1 无 package.json，上述命令不可运行，应如实记录。许可方案尚待仓库所有者确认，复制其他仓库代码前核对并保留其许可/版权。
