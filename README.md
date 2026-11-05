# GlobalSite

独立的 AI 建站与运营产品，面向 B2B 外贸企业，可单独使用，也可选择连接 GlobalCRM。

当前已完成 **S2 基础能力与 S3 产品/资料/事实库**：独立账号与组织、邮箱验证、Cookie 会话、刷新轮换、CSRF、邮箱两步验证、忘记密码、账号锁定、成员邀请与三种角色、审计、套餐额度、文件存储、后台任务租约、AI 服务商配置，以及中英双语管理台。另有产品键值/表格规格、图片与 PDF/证书、Excel 映射与错误行、事实来源/人工审核/历史、AI 候选提取、遵守 robots.txt 与 SSRF 防护的旧站读取。建站 Agent、发布与 CRM 连接按 S4–S7 继续实现。

## 一键启动（本地开发）

需要 Docker Desktop / Docker Compose。默认不需要 .env：

```sh
docker compose up -d --build
docker compose ps
```

打开 [GlobalSite](http://localhost:5080)，注册后在页面打开“开发邮件预览”，点击验证链接，再登录。api 与 worker 独立进程，MongoDB 为单节点副本集，数据库固定 globalsite；使用新建的 globalsite_mongo / globalsite_storage 卷。

默认仅绑定本机：网站 5080，开发 MongoDB 27018。端口占用时设置 API_PORT，并将 PUBLIC_URL 同时设为对应网址。已有 .env 如包含开发端口 5173，运行 Compose 前需将 PUBLIC_URL 改为 http://localhost:5080。不要停止其他项目的服务，也不要将 MongoDB 开发端口暴露到公网。

停止服务用 docker compose down；该命令保留数据卷。不要用 down -v 删除已有数据。

## 本地代码开发

Node >=20.19；MongoDB 7+ 且启用副本集。可以只使用 Compose 中的 MongoDB：

```sh
npm ci --ignore-scripts
docker compose up -d mongo
```

复制 .env.example 为 .env（此文件不会提交），保持 PUBLIC_URL=http://localhost:5173、MONGODB_URI 指向本机 27018 的 globalsite，然后运行：

```sh
npm run dev
```

管理台 [localhost:5173](http://localhost:5173)，API 为 [localhost:5001](http://localhost:5001/api/v1/health/ready)，worker 独立运行。开发和容器使用同一接口与权限逻辑，均无默认管理员/默认密码，管理员通过注册创建。

## 检查与迁移

```sh
npm run typecheck
npm run build
npm run lint
npm test
npm run migrate
```

npm test 使用独立的临时 MongoDB 副本集，不连接开发数据库；首次运行可能下载数据库程序。安装时的 --ignore-scripts 防止安装阶段重复下载，测试运行时再准备所需版本。测试默认 MongoDB 7.0.14，可通过 MONGOMS_VERSION/MONGOMS_SYSTEM_BINARY 指定本机测试程序，不能指向现有数据库。

浏览器验收（先启动 Compose）：

```sh
npx playwright install chromium
npm run test:e2e
```

迁移 s2-foundation-v1 与 s3-products-facts-v1 创建 globalsite 集合/索引并写入迁移账本，可重复执行；api/worker 启动时也会执行。它不会连接或修改 CRM 数据库。

## 邮件、AI 与安全

- 无 SMTP：开发环境记录脱敏通知编号，页面提供一小时有效的随机能力链接查看开发邮件；不把邮箱、邮件正文、验证码、重置链接或会话写入日志。生产禁用开发预览；未配置 SMTP 时邮件保留队列等待配置。
- 无 AI：账号/组织/文件/成员等功能正常可用。组织管理员可以在 AI 页面保存加密密钥，启用后测试连接。S2 仅允许 OpenAI 官方 HTTPS 服务地址，模型由管理员填写；不默认调用付费模型。
- 生产配置见 production.env.example。生产部署必须配置独立的 32 字节 Base64 CREDENTIAL_ENCRYPTION_KEY、HTTPS 和可送达的 SMTP。开发自动生成的存储卷 .local-key 不用于生产。替换主密钥前必须迁移重加密已有数据，S2 不提供自动主密钥轮换。
- 会话 access 15 分钟，refresh 14 天；轮换后旧 refresh 重放会吊销当前会话。每次请求校验当前成员角色；撤销成员/会话立即失效。五次密码错误锁定 15 分钟；验证码五分钟、最多五次、单次消费。
- 所有组织业务模型使用 tenant 插件；全局身份、组织根与系统计数只能通过受限身份上下文访问。后台只跨组织领取任务，处理回到组织上下文。浏览器不能指定组织数据访问范围。
- React Router 按指定栈保留 6。当前审计有两项 moderate 传递依赖告警；登录返回地址有严格内部路径白名单，本站不使用 SSR hydration。生产依赖 high/critical 门槛通过；后续需评估获准的修补版本，不自动升级到 7。

## 文档与契约

- [MVP 技术设计](docs/design/MVP-设计.md)
- [S3 产品、资料与事实库](docs/design/S3-产品与事实.md)
- [S3 运行与验收](docs/operations/S3-运行与验收.md)
- [S2 模块、数据与安全边界](docs/design/S2-基础模块.md)
- [运行与验收记录](docs/operations/S2-运行与验收.md)
- [GlobalSite 基础 API OpenAPI](docs/api/foundation.openapi.yaml)：59 个本站私有操作，不包含 CRM Integration API。
- [协作规则](AGENTS.md)
- CRM 唯一对接依据：[OpenAPI](https://github.com/D77-jpg/GlobalCRM/blob/60cdbc48035301c152a58b924558b08a850fa36a/docs/integration/integration-v1.openapi.yaml) 与[双方对接设计](https://github.com/D77-jpg/GlobalCRM/blob/60cdbc48035301c152a58b924558b08a850fa36a/docs/integration/globalsite-%E5%AF%B9%E6%8E%A5%E8%AE%BE%E8%AE%A1.md)。本站不复制该契约、不 import 或 npm link CRM 代码。

来源与精简记录见 S2 模块文档；保留逐文件来源注释。源 CRM 基线未附 LICENSE，本次按同一所有者的复制改造授权实施，不额外宣称对第三方授予开源许可。

审计补充：全量锁定依赖当前有 9 项 moderate（含开发工具链），生产依赖中有 2 项 moderate；无 high/critical。已修补新增 YAML 解析器的高风险版本，未强制升级 Router 或降级 lint 工具以隐藏告警。
