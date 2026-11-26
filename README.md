# GlobalSite

面向 B2B 外贸企业的独立 AI 建站与增长运营平台——可独立运行，也可按需连接 GlobalCRM。

核心特性：
- **多租户与零幻觉事实门禁**：产品库、文档/PDF、Excel 导入、合规旧站读取与人工确认事实库；所有数字、认证、产能、年份声明强制引用已确认事实。
- **可控 AI 建站 Agent 闭环**：业务策略规划 → 成对视觉提案 → 多语种内容生成（8 语种，含阿拉伯语 RTL）→ 375/768/1440 浏览器截图审查与修订；支持按任务路由模型、可选 `json_schema` 严格输出（400 自动无重复计费回退）与新建站一键快速规划通道。
- **S32 多风格旗舰独立站渲染引擎**：本地离线打包 4 套 SIL OFL 字体与 9 套 WCAG AA 行业视觉体系（暗黑奢华 `obsidian`、画廊暖白 `ivory`、德系工业 `graphite`、清洁能源 `ocean` 等），隔离 Astro 构建、不可变版本 zip、登录预览与 Cloudflare Pages / Webhook 发布。
- **外贸转化与合规**：独立询盘网关（CORS/限流/Turnstile/加密附件）、询价清单、Cookie 合规、自动回复邮件与可选 GlobalCRM 集成。

完整阶段演进记录见 [CHANGELOG](docs/CHANGELOG.md)。

---

## 一键启动（Docker Compose）

需要 Docker Desktop / Docker Compose（默认无需 `.env`）：

```sh
docker compose up -d --build
docker compose ps
```

打开 [http://localhost:5080](http://localhost:5080)，注册管理员账号后在页面打开「开发邮件预览」完成验证并登录。

- 默认仅绑定本机：Web/API `5080`，开发 MongoDB `27018`。
- `api` 与 `worker` 独立进程运行，使用独立 `globalsite` 数据库与持久卷（`globalsite_mongo` / `globalsite_storage`）。
- 停止服务请用 `docker compose down`（保留数据卷）；**切勿使用 `down -v` 删除已有数据**。

## 本地代码开发

环境要求：**Node >= 22.23.4**、MongoDB 7+（单节点副本集）。

```sh
npm ci --ignore-scripts
docker compose up -d mongo
cp .env.example .env
npm run dev
```

管理台访问 `http://localhost:5173`，API 健康检查 `http://localhost:5001/api/v1/health/ready`。

## 质量检查与测试

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run test:quality
node scripts/s33-benchmark.mjs
```

浏览器端到端验收（先启动 Compose）：

```sh
npx playwright install chromium
npm run test:e2e
```

## 安全与生产部署边界

- 生产环境参考 `production.env.example`：必须配置独立的 32 字节 Base64 `CREDENTIAL_ENCRYPTION_KEY`、HTTPS `PUBLIC_URL` 与可用 SMTP；开发邮件预览仅限非生产环境。
- 未配置 AI / SMTP / Cloudflare 时核心功能均安全降级，不阻断启动与建站预览。
- 严格 CSP（`style-src 'self'`）、精确 Origin + 会话绑定 CSRF、访问/刷新令牌轮换与重放吊销、全量多租户插件隔离、后台任务租约围栏均不可绕过。

## 关键文档与契约

- [协作规则与维护约束](AGENTS.md)
- [阶段演进记录](docs/CHANGELOG.md)
- [GlobalSite 私有 API OpenAPI](docs/api/foundation.openapi.yaml)
- [公开询盘网关 OpenAPI](docs/api/inquiry-gateway.openapi.yaml)
- [S33 Agent 质量与体验优化](docs/design/S33-%E4%BC%98%E5%8C%96%E8%AF%B4%E6%98%8E.md) · [S33 多行业回归基准](docs/verification/S33-%E5%A4%9A%E8%A1%8C%E4%B8%9A%E5%9B%9E%E5%BD%92%E5%9F%BA%E5%87%86.md)
- [S32 多风格旗舰独立站渲染引擎](docs/design/S32-%E6%97%97%E8%88%B0%E7%8B%AC%E7%AB%8B%E7%AB%99%E6%B8%B2%E6%9F%93%E5%BC%95%E6%93%8E.md)
- [S30–S31 外贸视觉策略工作室](docs/design/S30-%E5%A4%96%E8%B4%B8%E5%B7%A5%E4%BD%9C%E5%8F%B0%E4%BA%A7%E5%93%81%E9%87%8D%E6%9E%84.md)
- [S7 GlobalCRM 可选连接](docs/design/S7-GlobalCRM%E8%BF%9E%E6%8E%A5.md)
