# GlobalSite 协作规则
## 仓库与授权
- 本仓库 D:/Trade/genesis/GlobalSite，独立 B2B AI 建站产品，CRM 可选。
- 每条命令与编辑前确认工作目录；git 只能在此仓库执行。另一个仓库只读，除非任务明确分别授权。
- GlobalCRM 当前路径 D:/Trade/genesis/CRM/GlobalCRM；废弃旧目录禁止读取或修改。
- 本任务 S1 仅可改 README.md、AGENTS.md、docs/、.gitignore；不写业务代码、环境文件或依赖。
- 分别分支/提交/PR，禁止混仓；后续分支 feat/<任务编号>-<简述>，S1 docs/s1-design，不直接推 main。

## 架构边界
- 独立 MongoDB globalsite；不得直连 CRM 库，只通过 Integration API。
- 不互相 import、不 npm link；复制代码须标明来源路径、源 commit、许可与改造并补测试。
- 唯一 CRM 契约在 GlobalCRM docs/integration/integration-v1.openapi.yaml 和 globalsite-对接设计.md；本站不复制维护。
- 接口变化按契约→CRM 实现→本站调用；发现不一致停止受影响工作并汇报。
- GS-D01 已获用户同意：登记现有客户状态/报价查询未文档化来源参数；MVP 不调用，保持现状。
- C1–C4 为 S1 提议拆分，草案未实现不得当在线能力；S2–S7 详见 MVP 设计。

## 实施约束
- 开始前读相关文档/代码，简述仓库/文件/模型/迁移计划。
- Node >=20.19、Express 4、TS、Mongoose 8、zod；React 18/Vite/Tailwind/router6/react-hook-form；node:test+tsx。
- 组织业务模型接 tenant 插件，禁止无租户上下文放行；全局身份/组织根仅受限认证模式。
- 人工确认事实才可生成硬声明；人工审核版本后方可发布；凭证/询盘不能进入静态产物、日志或测试快照。
- 前端可见文案 zh/en i18n；可选服务未配置应降级，不导致全站启动失败。
- 新环境变量在获准工程阶段写 .env.example 与 production.env.example；不提交真实密钥、.env、上传、.dsh 或临时产物。
- 完成 typecheck/build/lint/test 与适用契约/E2E；S1 仅文档无工程脚本，明确记不可运行。
- 任务结束更新相关文档与本规则。根 AGENTS 变更须在当前任务允许范围内。
- 汇报仓库/分支/提交/PR、摘要、文件、契约、迁移、命令结果、限制及手动事项；不可将未跑或跳过测试说成通过。
