# Timeline

`luckyrong.ysoseri.us/timeline/` 的恋爱时间轴。页面公开浏览，固定密码验证后可在页面内维护轴、事件与媒体。

## 技术栈

- Astro 5 + React island
- GSAP + ScrollTrigger
- Rough.js + d3-shape
- Cloudflare Pages + `luckyrong-router`
- Cloudflare D1 + R2

## 本地开发

```powershell
npm install
npm run dev
```

生产构建固定使用 `/timeline/` base path：

```powershell
npm run build
```

Timeline API 由 `ysoseri.us` 工作区中的 `luckyrong-router` 提供。生产密码与 JWT 密钥只存放在 Cloudflare Worker secrets 中。

## 部署

- 生产入口：`https://luckyrong.ysoseri.us/timeline/`
- Pages 源站：`https://timeline-7z2.pages.dev`
- Cloudflare Pages 从 GitHub `main` 分支自动构建，命令为 `npm run build`，输出目录为 `dist`。
