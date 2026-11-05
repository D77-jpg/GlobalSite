export const publishingMessages = {
  versionReady: ["版本就绪", "Version ready"],
  PUBLICATION_IN_PROGRESS: [
    "正在发布，请等待发布结果核对完成后再编辑。",
    "Publication is in progress. Wait for reconciliation before editing.",
  ],
  IMAGE_ALT_REQUIRED: [
    "请选择图片并填写图片说明。",
    "Choose an image and supply alternative text.",
  ],
  IDEMPOTENCY_CLOSED: [
    "该次操作已结束，请重新发起。",
    "This operation has ended. Start a new request.",
  ],
  DEPLOYMENT_REJECTED: [
    "Cloudflare 拒绝了发布，请核对权限、项目和配额。",
    "Cloudflare rejected the deployment. Check permissions, project and quota.",
  ],
  reconcile: ["核对远端结果", "Reconcile remote result"],
  DOMAIN_NOT_READY: [
    "请先检测并确认自定义域名 HTTPS 正常。",
    "Check and confirm HTTPS for the custom domain first.",
  ],
  VERSION_SOURCE_CHANGED: [
    "站点内容已改变，请重新审核和构建。",
    "Site content changed. Review and build again.",
  ],
  title: ["构建与发布", "Build & publish"],
  back: ["返回站点", "Back to site"],
  settings: ["发布设置", "Publishing settings"],
  base: ["正式网址（HTTPS）", "Production URL (HTTPS)"],
  account: ["Cloudflare 账户 ID", "Cloudflare account ID"],
  project: ["Pages 项目名称", "Pages project name"],
  branch: ["生产分支", "Production branch"],
  domain: ["自定义域名（可选）", "Custom domain (optional)"],
  token: [
    "Cloudflare Token（仅更新时填写）",
    "Cloudflare token (fill only to replace)",
  ],
  save: ["保存设置", "Save settings"],
  saved: ["已保存", "Saved"],
  configured: ["Cloudflare 已配置", "Cloudflare configured"],
  offline: [
    "尚未连接 Cloudflare，仍可构建、预览和导出 zip。",
    "Cloudflare is not connected. Builds, previews and zip exports remain available.",
  ],
  check: ["上线前体检", "Preflight"],
  repair: ["修复可自动处理的项目", "Repair automatic items"],
  repairHint: [
    "仅补齐可从现有文字获得的描述与图片说明，修复后需要重新审核。",
    "Only fills descriptions and image text from existing content. Reapproval is required.",
  ],
  build: ["构建新版本", "Build new version"],
  versions: ["版本", "Versions"],
  deployments: ["发布记录", "Deployments"],
  preview: ["登录预览", "Private preview"],
  download: ["导出 zip", "Export zip"],
  publish: ["发布此版本", "Publish version"],
  rollback: ["回滚到此版本", "Roll back to version"],
  confirm: [
    "将以此版本替换正式站点。继续？",
    "Replace the production site with this version?",
  ],
  ready: ["体检通过", "Preflight passed"],
  blocked: ["请先处理下列项目", "Resolve these items first"],
  domainCheck: ["检测域名与 HTTPS", "Check domain & HTTPS"],
  domainHint: [
    "在 Cloudflare Pages 项目中添加该域名，再按控制台指引配置 DNS。子域名通常指向 项目名.pages.dev；根域名按 Cloudflare 指引接入。检测通过后再对外使用。",
    "Add the domain in your Cloudflare Pages project, then follow its DNS instructions. Subdomains generally point to project.pages.dev; follow Cloudflare instructions for apex domains. Check HTTPS before sharing.",
  ],
  palette: ["从 Logo 提取配色建议", "Suggest colors from logo"],
  paletteHint: [
    "选择颜色会更新站点并撤回地图确认与页面批准，请重新审核。",
    "Choosing a color updates the site and invalidates plan confirmation and page approvals. Review again.",
  ],
  readonly: [
    "只读账号可查看版本与体检结果。",
    "Read-only accounts can view versions and preflight results.",
  ],
  live: ["已上线", "Live"],
  queued: ["排队中", "Queued"],
  building: ["构建中", "Building"],
  failed: ["失败", "Failed"],
  unknown: [
    "发布状态待核实，请保留记录并联系管理员；不会自动重复发布。",
    "Deployment status needs reconciliation. Keep this record and contact your administrator; submission will not be repeated automatically.",
  ],
  verifying: ["核验中", "Verifying"],
  uploading: ["上传中", "Uploading"],
  valid: ["HTTPS 正常", "HTTPS valid"],
  pending: ["待生效", "Pending"],
  unconfigured: ["未配置", "Not configured"],
  error: [
    "操作未完成，请重试或检查体检结果。",
    "The action did not complete. Retry or review preflight results.",
  ],
  BUILD_BUSY: ["已有构建任务，请等待完成。", "A build is already in progress."],
  SITE_NOT_READY: [
    "页面需要先审核通过，并完成体检。",
    "Approve pages and resolve preflight issues first.",
  ],
  CLOUDFLARE_UNCONFIGURED: [
    "请先配置 Cloudflare；也可以使用 zip 导出。",
    "Configure Cloudflare first, or export a zip.",
  ],
  VERSION_FACTS_CHANGED: [
    "该版本引用的事实已变更，请重新审核和构建。",
    "Referenced facts changed. Review and build a new version.",
  ],
  DIRECT_UPLOAD_REQUIRED: [
    "请选择独立的 Direct Upload Pages 项目并核对生产分支。",
    "Use a Direct Upload Pages project and check its production branch.",
  ],
  DEPLOYMENT_BUSY: [
    "当前发布尚未结束，请先处理该记录。",
    "A deployment is still active. Resolve it first.",
  ],
  VERSION_CONFIG_CHANGED: [
    "发布网址或设置已改变，请重新构建。",
    "Publishing settings changed. Build a new version.",
  ],
  CANONICAL_REQUIRED: ["请填写正式网址。", "Enter the production URL."],
  PLAN_NOT_CONFIRMED: ["请确认站点地图。", "Confirm the site plan."],
  PAGE_NOT_APPROVED: ["页面尚未批准。", "Page is not approved."],
  PAGE_MISSING: ["尚有页面未创建。", "A page is missing."],
  DESCRIPTION_MISSING: ["缺少页面描述。", "Page description is missing."],
  TITLE_DUPLICATE: [
    "页面标题重复，请编辑。",
    "Duplicate page title. Edit the page.",
  ],
  CONTENT_TOO_SHORT: [
    "内容过少（正文至少 60 个单词）。",
    "Content is too short (at least 60 words).",
  ],
  ALT_MISSING: ["缺少图片说明。", "Image alternative text is missing."],
  UNSOURCED_NUMBER: [
    "数字缺少已确认依据。",
    "A number has no confirmed source.",
  ],
  UNSOURCED_CERTIFICATION: [
    "认证缺少已确认依据。",
    "A certification has no confirmed source.",
  ],
  CANONICAL_INVALID: [
    "正式网址须为公开域名的 HTTPS 根地址。",
    "Use an HTTPS root URL with a public hostname.",
  ],
  DOMAIN_CANONICAL_MISMATCH: [
    "正式网址须与自定义域名或 Pages 项目网址一致。",
    "Production URL must match the custom domain or Pages project URL.",
  ],
  LOGO_REQUIRED: ["请先为站点选择 Logo。", "Choose a site logo first."],
  ROLLBACK_VERSION_REQUIRED: [
    "只有曾成功上线的版本可以回滚。",
    "Only a previously live version can be a rollback target.",
  ],
  BUILD_FAILED: [
    "构建失败，请检查页面和资料后重新构建。",
    "Build failed. Review content and assets, then build again.",
  ],
  ACTOR_REVOKED: [
    "操作权限已变更，请重新登录。",
    "Permissions changed. Sign in again.",
  ],
  REVISION_CONFLICT: [
    "设置已更新，请刷新后重试。",
    "Settings changed. Refresh and retry.",
  ],
  PRODUCTION_CHANGED: [
    "线上版本已被其他操作改变，请核对发布记录。",
    "Production was changed elsewhere. Review deployment records.",
  ],
  DEPLOYMENT_UNKNOWN: [
    "暂时无法确认发布结果，请联系管理员核对。",
    "The deployment result is uncertain. Ask an administrator to reconcile it.",
  ],
  label: ["操作", "Actions"],
  created: ["创建时间", "Created"],
  state: ["状态", "Status"],
  clear: ["移除已保存的 Token", "Remove saved token"],
  previewHint: [
    "预览需要登录并禁止索引；正式产物不会附带预览限制。",
    "Preview requires sign-in and is marked noindex. Production artifacts do not carry preview restrictions.",
  ],
  formHint: [
    "询盘在线提交将在后续任务开放，本版本只展示禁用的表单。",
    "Online inquiry submission arrives in a later phase. This version displays a disabled form.",
  ],
} as const;
