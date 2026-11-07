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

## 离线使用

页面可以在完全没有网络时打开、翻阅和编辑（文字和图片；视频仍需联网上传）。

- `public/sw.js` 由 `scripts/build-sw.mjs` 在构建时生成（模板 `src/sw.template.js`），预缓存页面文件；图片在浏览时或「离线准备」时缓存。
- 编辑先写入本机 IndexedDB（`src/components/timeline/offline/`），再由同步按顺序发到服务器：每个请求带 `Idempotency-Key`，修改和删除带 `X-If-Updated-At`；线上已变化时返回 409，页面让用户选择保留哪个版本。
- 「离线准备」「导出 / 导入未同步改动」在工具栏 ☁︎ 按钮里。
- iPhone 建议从 Safari「添加到主屏幕」后使用；主屏幕 App 与 Safari 的存储和登录状态是分开的。
