# 本地 AI 接入

非生产可使用 workbuddy2api。AI_LOCAL_BASE_URL 明确指定精确的 http://host.docker.internal:7863/v1 或 loopback /v1；默认关闭，生产拒绝。连接固定解析 IP，禁重定向。不放宽旧站或 CRM 的 SSRF 规则。

本机部署：docker compose -f compose.yaml -f compose.ai-local.yaml up -d --build api worker。保留数据库与 storage 卷。组织管理员随后在 AI 服务商页填写模型、通过密码框保存密钥；密钥不写源码、Compose、日志或截图。测试只发送 Reply with OK。无数据迁移，CRM 无改动。

## Agent 兼容与验收

连接测试只验证短请求，不能代表研究/内容任务已跑通。Agent 的 user 消息必须带明确执行指令，并同时传入可信任务规则与标记为不可信的业务资料；仅发送资料 JSON 时，部分本地兼容服务会回答说明文字。规划明确提供页面类型、采购意图、ID、层级和路径约束；内容提供所有区块字段、字数上限、缺失事实占位和空规格表规则。仍严格 JSON.parse + zod 校验，不从任意说明文字中猜测/提取 JSON，不放宽事实门禁。

单次站点 Agent 请求最多 120 秒，Worker 仍每 20 秒续租。额度预留覆盖实际转发的两份规则与资料。已收到、持久化并计费但格式不合规的结果使用新 operationId 有限重试（最多三次）；未知网络结果保留旧 operationId 与预留并暂停，禁止自动重新付费。成功页持久化后恢复不重复生成。

真实验收必须从组织页面触发 research，再确认 Agent 生成的地图、运行 content；检查任务步骤成功与生成页，再审核、构建预览。不能用手工页面替代 Agent 成功。模板/公司参数/认证等缺失仍保持待确认，不将演示数据冒充公司事实。
