# S29 暗黑旗舰 UI 设计系统（Obsidian AI Studio）

## 1. 设计目标与定位

面向精品建站与 AI Studio 专业工作流，将 GlobalSite 管理台由早期多层覆盖的浅米绿界面全面升级为 **Dark-First 沉浸暗黑工作台（Obsidian AI Studio）**，并内置 **浅色瓷白模式（Porcelain Studio）** 一键切换。

## 2. 核心设计架构

- **权威主题层**：新增 [obsidian-studio.css](../../web/src/obsidian-studio.css)，作为 [main.tsx](../../web/src/main.tsx) 最终加载的设计令牌与视觉覆写层，统一接管 16 个历史样式表中的硬编码底色、边框、文字与按钮状态。
- **双模式语义令牌**：
  - 默认暗黑模式（`:root[data-theme="dark"]`）：深空炭黑画布 `#080a0f` + 柔和靛蓝/翡翠顶部微光 + `#111521` 细亮边抬升卡片 + 靛蓝高光主按钮 + 语义色胶囊状态指示（翠绿/琥珀/天蓝/玫红）。
  - 浅色瓷白模式（`:root[data-theme="light"]`）：冷瓷白画布 `#f5f7fb` + 磨砂顶栏 + 纯白卡片与细腻层级阴影。
- **首屏零闪烁与主题记忆**：[index.html](../../web/index.html) 默认声明 `data-theme="dark"` 与 `theme-color="#090b10"`；[main.tsx](../../web/src/main.tsx) 通过 `ThemeCtx` 读写 `localStorage` 中的 `globalsite_theme`（仅 UI 偏好，不存任何凭证），顶栏与登录页右上角均提供 `ThemeButton` 一键切换。
- **安全与边界**：
  - 严格遵守 `style-src 'self'` CSP，零内联 `style` 与零内联 `<script>`。
  - 页面实时预览 `iframe` 保持中性白底边框，确保独立站真实配色不受管理台暗黑背景干扰。
  - 不改变任何 API、路由、权限校验或建站/事实/审核门禁。
