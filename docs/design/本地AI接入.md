# 本地 AI 接入

非生产可使用 workbuddy2api。AI_LOCAL_BASE_URL 明确指定精确的 http://host.docker.internal:7863/v1 或 loopback /v1；默认关闭，生产拒绝。连接固定解析 IP，禁重定向。不放宽旧站或 CRM 的 SSRF 规则。

本机部署：docker compose -f compose.yaml -f compose.ai-local.yaml up -d --build api worker。保留数据库与 storage 卷。组织管理员随后在 AI 服务商页填写模型、通过密码框保存密钥；密钥不写源码、Compose、日志或截图。测试只发送 Reply with OK。无数据迁移，CRM 无改动。
