# Timeline 设计文档（PRD + SOP）

> luckyrong.ysoseri.us/timeline — 恋爱时间轴
> 最后更新：2026-07-29

---

## 一、产品定义

### 1.1 定位

一本正在书写的私密日记。不是展览的相册，不是产品 landing page。进来的人感受到的是时间在流动、故事在积累。

核心体验：**向下滚动 = 翻旧日记**。页面顶部是今天，纸张洁白墨水新鲜；越往下滚，纸张泛黄、墨水氧化褪色——连续的、不被感知的老化。

### 1.2 用户

- 主要用户：她（laptop or iPhone 16）
- 次要用户：我的朋友（桌面浏览器）
- 编辑者：仅我自己

### 1.3 访问模式

- **公开可看**：无需登录即可浏览完整时间轴
- **登录可编辑**：点击编辑按钮时触发密码验证，不阻塞浏览流程

### 1.4 不做的事

- 不做移动端响应式兼容
- 不做 demo/MVP 再迭代——直接做成品
- 不先砍功能再加回来

---

## 二、设计语言

### 2.1 手工感原则

| 维度 | 实现方式 | 不做 |
|------|----------|------|
| 纸张质感 | 米白底 + SVG feTurbulence 纤维感噪点 | 光滑纯色背景 |
| 字体温度 | 衬线体（Instrument Serif）+ 手写体（Caveat） | UI 无衬线体 |
| 线条不完美 | Rough.js 渲染，自带歪扭和颗粒断裂 | 完美直线/圆弧 |
| 颜色 | 墨水色/蜡笔色，亮但不刺眼 | 饱和色/荧光色 |
| 装饰 | 来自内容（照片边缘、日期戳、缩略图旋转） | UI 组件/图标装饰 |

### 2.2 配色体系

独立调性，不复用 homepage 或 luckyrong 主站色系。

#### 纸张（背景）— 连续渐变

| 位置 | 色值 | 感觉 |
|------|------|------|
| 顶部（最新） | `oklch(0.96 0.01 80)` | 奶油白，新纸 |
| 底部（最旧） | `oklch(0.90 0.04 75)` | 旧纸黄，泛黄 |

#### 墨水（正文）— 连续渐变，iron gall ink 氧化路径

| 位置 | 色值 | 感觉 |
|------|------|------|
| 顶部（最新） | `oklch(0.25 0.02 260)` | 蓝黑，钢笔墨水刚干 |
| 底部（最旧） | `oklch(0.32 0.03 55)` | 暖褐灰，氧化几年后 |

**Hue 插值路径**（必须指定，不走默认短路径）：
```
260°(蓝黑) → 300°(紫灰) → 360°/0°(红褐) → 55°(暖棕)
```
经过红/橙方向，对应真实 iron gall ink 氧化色相演变。oklch 保证中间不出灰色/脏色。

#### 噪点透明度 — 连续渐变

| 位置 | opacity |
|------|---------|
| 顶部 | 0.105 |
| 底部 | 0.145 |

#### 其他颜色

| 元素 | 色彩规则 |
|------|----------|
| 日期文字 | 比正文浅一档，偏暖灰（褪色墨水） |
| 轴线蜡笔 | 亮但不刺眼，恒定不随滚动变化，支持自定义 |
| 里程碑背景 | 所属轴蜡笔色 opacity 0.06~0.10 |
| hover 状态 | 不变色，物理反馈（微抬 + 阴影加深） |

### 2.3 字体

| 用途 | 字体 | 来源 |
|------|------|------|
| 正文/标题 | Instrument Serif | 自托管 woff2（已有） |
| 日期戳/caption/折叠标记 | Caveat | Google Fonts |
| 中文 fallback | Noto Serif SC | Google Fonts |

### 2.4 布局："满纸"而非"满屏"

- 纸张纹理铺满整个视口，延伸到屏幕边缘之外（视觉上纸比屏幕大）
- 内容区（轴线 + 节点）左右保留 **48~64px 呼吸边距**（笔记本页边空白）
- 无可见容器边界、无卡片外框、无分割线
- 内容直接"长在纸面上"

---

## 三、核心功能

### 3.1 多轴并行

多条竖向蜡笔线并行，每条轴代表一个叙事维度。

#### 轴的分类

融合"人轴"和"事轴"：
- **人轴**：我们（共同）/ 我 / 她
- **事轴**：旅行 / 里程碑 / 日常 / 异地 / ……

两者可叠加。轴支持动态创建（命名 + 选色）。

#### 轴间距

- “我们”通过 `is_primary` 标记为唯一主轴，始终固定在画面几何中心，不随列表位置偏离中央
- 主轴是左右次轴的顺序分界：排序在主轴前的轴分布在左半页，排序在主轴后的轴分布在右半页
- 每一侧都在页边距与主轴之间均匀分布；轴数或顺序变化时 GSAP 平滑过渡
- 主轴线宽 `5.2px`，普通轴线宽 `3.6px`，筛选弱化时同步变细
- 编辑器中的次轴整行都是拖拽热区，可跨过主轴调整左右位置；右侧“拖”保留为视觉提示和键盘焦点，并支持上下方向键排序。主轴本身固定且不可拖动

#### 轴的生命周期

- 轴可以在某段时间出现/消失（如"异地"轴只在异地期间存在）
- 沉默的轴（当前时间段无事件）变为虚线
- 轴的出现/消失有 GSAP 动画过渡
- 唯一主轴贯穿完整时间轴，不允许设置分支来源、出现日期、结束日期或合流目标，也不能删除

#### 分支与合流

- 支线从主轴以贝塞尔曲线弯出
- 支线比主轴细，颜色从主轴色派生（饱和度降低）
- 结束时以贝塞尔曲线合回主轴或消失
- 弧线是整个页面最有手工感的元素

#### 交汇节点

- 一个事件属于多条轴时，用弧线/连接线连接
- 连接线颜色是两条轴颜色的混合

### 3.2 节点

#### 节点类型与默认展示

| 类型 | 默认态 | 视觉感受 |
|------|--------|----------|
| 普通记录 | 日期 + 标题 + 正文摘要 + 手选封面 + 自动内容构成 | 同一种日记版式，可同时承载文字、图片与视频 |
| 里程碑 | 全宽卡片 + 半透明色块背景 + 大标题 + 副标题 | 章节封面，默认展开 |

- `type` 只表达结构版式，取值为 `entry` 或 `milestone`，不再把文字、照片、视频误作互斥节点类型；
- 普通记录的内容构成从实际字段和媒体清单自动推导，例如“文字 · 6 图 · 1 视频”，不保存需要用户维护的冗余标签；
- `cover_media_key` 可从当前事件的任一图片或视频中手动指定；未指定、封面被移除或 key 失效时回退到第一个附件。

#### 节点位置

- 贴在轴线上，从轴侧边伸出
- 一个节点包含主轴 tag 时优先挂在主轴上；需要侧挂的主轴节点按日期倒序后的序号严格右/左交替，事件 ID、次轴事件和全宽里程碑均不影响交替
- 不包含主轴的节点挂在其最靠前的所属轴上
- 新建节点默认勾选唯一主轴（当前为“我们”），仍可手动增删其他 tag

#### 节点交互：3D 浮层

点击节点 → 内容从纸面"浮起"：

**初态**（压在纸里）：
```css
transform: translateZ(-20px) scale(0.97);
opacity: 0;
filter: blur(1px);
```

**激活态**（浮到纸面）：
```css
transform: translateZ(0) scale(1);
opacity: 1;
filter: blur(0);
box-shadow: 0 8px 24px rgba(44,36,22,0.10);
```

规则：
- 父容器 `perspective: 1000px`
- 同时只有 1 个浮层激活（显存 < 2MB）
- 浮层从节点位置展开，max-width 480px，不居中
- 节点在右侧 → 浮层向左展开；反之亦然
- 关闭时 GSAP `timeline.reverse()` 原路落回
- `will-change` 仅动画期间添加，结束后移除
- 背景轻微模糊（`backdrop-filter: blur(3px)`，蒙层上）

#### 展开后内容排版

**普通记录**：
- 标题：Instrument Serif
- 日期：Caveat 手写体小字，颜色浅一档
- 正文：Instrument Serif 15-16px，行高 1.8
- 文字、图片与视频可同时存在，默认节点展示自动生成的内容构成
- 封面使用手动指定的媒体；没有有效指定时使用第一个附件
- 底部：tag chips（所属轴标识）

**图片内容**：
- 照片占浮层主体（宽度 100%，max-height 约束）
- 多张照片横向排列，可左右滑动或 grid
- 点击单张 → GLightbox 全屏
- 照片下方可选 caption（Caveat 手写体）

**视频内容**：
- 展开后内嵌 `<video>` 播放器
- 不自动播放，点击播放
- R2 存 mp4 → 原生 `<video>`

**里程碑节点**：
- 不需点击展开——默认全宽展开
- 大标题居中 + 副标题/日期
- 背景：所属轴蜡笔色 opacity 0.06~0.10
- 在视觉上把时间轴分成"章"

### 3.3 时间折叠

**全局双模式切换**，阈值 3 个月。

| 模式 | 行为 | 适合 |
|------|------|------|
| 📖 紧凑模式（默认） | 所有节点等间距排列，>3个月空白折叠为 "· · · N 个月 · · ·"（Caveat 手写体） | 阅读内容 |
| 📐 时间轴模式 | 恢复真实时间比例，空白完整展示，轴线贯穿 | 感受时间跨度 |

- 切换控件在工具托盘中
- 切换时 GSAP 驱动所有节点位置重排动画（平滑，不瞬切）
- 折叠标记（"· · · N 个月 · · ·"）只在紧凑模式显示

### 3.4 标签筛选

工具托盘中的筛选 chips：
- 按轴筛选（只看"旅行"轴）
- 按人筛选（只看"我们"的事件）
- 支持多选（并集激活）
- 筛选时：匹配轴高亮，非匹配轴 fadeOut 变虚线（GSAP 编排）
- 默认进入页面时无筛选（全部显示）

### 3.5 年份导航

右侧浮动年份锚点：
- 竖排小字，细小安静
- 点击跳转到对应时间段

### 3.6 编辑功能

**页面内 inline 编辑，非独立后台。**

- 登录态后轴上出现"+"按钮，节点出现编辑/删除按钮
- 新增：选择轴（可多选 = 跨轴）+ 填标题/日期/描述 + 拖拽上传媒体
- 编辑：原地弹出浮层修改
- 新建轴：命名 + 选颜色
- 轴管理：列表从上到下对应纸面从左到右；按住次轴任意位置拖动，或在“拖”按钮上使用上下方向键调整顺序，跨过“我们”即可换到主轴另一侧。普通点击仍用于选中编辑
- 未登录时纯展示，编辑控件不渲染

---

## 四、导航：浮动工具托盘

### 4.1 结构

| 位置 | 元素 |
|------|------|
| 左上角落 | 返回按钮（← luckyrong），小且安静 |
| 底部居中浮动 | 工具托盘（主交互入口） |
| 右侧浮动 | 年份锚点（竖排） |

### 4.2 工具托盘内容

半透明毛玻璃圆角条，包含：
- 筛选 chips
- 📖/📐 模式切换
- 年份快跳下拉
- 登录后追加："+"新建节点

### 4.3 交互行为

- 平时半透明安静待命，hover 时完全不透明
- **固定位置**：托盘固定在页面底部居中，不提供拖拽把手，也不读取或保存位置到 localStorage
- 移动端托盘内容可横向滚动，纸面末尾预留安全区，避免末尾节点被遮挡
- 独立于 luckyrong 主站导航

---

## 五、色温漂移系统（SOP）

### 5.1 驱动方式

纸张老化绑定纸面内容坐标，而不是绑定滚动帧：背景渐变锚点使用 `stage.offsetTop + layout.events[i].y` 的实际页面 Y 坐标。滚动只是在翻阅已经生成的纸面，不再逐帧写入全局颜色变量或重绘整页纹理。

新增、删除、编辑事件或切换时间模式时重新计算锚点；日常滚动期间不做背景计算。事件墨色同样按日期年龄一次计算，并作为节点局部 CSS 变量使用。

### 5.2 变化维度

| 维度 | 顶部值（最新） | 底部值（最旧） | 插值方式 |
|------|----------------|----------------|----------|
| 背景色 | `oklch(0.96 0.01 80)` | `oklch(0.90 0.04 75)` | oklch 线性 |
| 墨水色 | `oklch(0.25 0.02 260)` | `oklch(0.32 0.03 55)` | oklch longer hue path |
| 噪点 opacity | 0.105 | 0.145 | 线性 |

### 5.3 Hue 插值路径

墨水色的 hue 从 260° 到 55°，必须走 longer path（经 300° → 0° → 55°），不走 shorter path（会经过绿色区域）。

实现方式：在 `paperAging.ts` 中用纯函数按事件日期一次计算进度，显式把 hue 按 155° 长路径插值并处理 360° 回绕；不在 ScrollTrigger `onUpdate` 中计算。

```js
const rawHue = 260 + progress * 155;
const hue = rawHue > 360 ? rawHue - 360 : rawHue;
const ink = `oklch(${lerp(0.25, 0.32, progress)} ${lerp(0.02, 0.03, progress)} ${hue})`;
```

### 5.4 纸张纹理

纸面仍由细颗粒、长纤维和纸浆密度云三层组成，但不再把 `feTurbulence` 作为 124% 尺寸的 fixed SVG 覆盖整页：

- 细颗粒和长纤维改为预加载的小尺寸可平铺 SVG，浏览器只需解码、缓存纹理单元；
- 纸浆层使用预加载的大尺寸低频随机纹理，表达纸浆厚薄与明暗不均；禁止规则圆环、可辨认的渐变中心或其他周期性几何图案；
- 三种稳定材质只解码和缓存，不随滚动重算；内容驱动的色温老化仍按事件实际 Y 坐标独立生成；
- 噪点强度仍从 0.105 连续增加到 0.145，通过一次生成的 Y 坐标 mask 表达；
- 不使用 `mix-blend-mode`、整页 `filter` 或 fixed 纹理，因此滚动不触发背景样式写入。

### 5.5 内容更新的实时性与无感事务

增删改、轴顺序变化和模式切换必须作为一次完整视觉事务提交：

1. API 与新布局准备完成前保留旧页面；失败时旧页面不消失；
2. 记录当前视口内的锚点事件及其相对偏移；
3. 保留旧 stage 快照和旧背景，新背景按新布局实际 Y 坐标准备；
4. 同一条 GSAP timeline 在 400ms 内让旧/新背景 opacity 交叉淡化、节点移动、旧/新轴层交叉淡化；新轴的 stroke-dashoffset 同步生长；
5. 动画结束后清理旧层和临时 `will-change`，并恢复阅读锚点。

删除事件时，新背景会在被删节点的旧 Y 位置加入由相邻新锚点插值得到的临时桥接色；事务结束后移除该冗余锚点。连续操作由 revision 机制取消旧结果，只允许最新请求提交，避免快速新增或切换时抖动。

---

## 六、轴线渲染系统（SOP）

### 6.1 技术串联

```
d3-shape（路径数学计算）
    ↓ 输出 SVG path d 属性
Rough.js（手绘化渲染）
    ↓ 输出带歪扭/颗粒感的 SVG elements
React（状态管理 + DOM 渲染）
    ↓ 管理筛选、hover、active、动画触发
GSAP（动画编排）
    ↓ 轴线生长、筛选切换、模式切换
```

### 6.2 Rough.js 参数

| 参数 | 值 | 效果 |
|------|-----|------|
| roughness | 1.5~2.5 | 蜡笔粗糙程度 |
| bowing | 1~2 | 线条自然弯曲 |
| strokeWidth | 3~4 | 蜡笔粗细 |
| stroke | 轴自定义颜色 | 蜡笔色，亮但不刺眼 |

### 6.3 分支贝塞尔计算

使用 d3-shape 的 `curveBumpY` 生成平滑 S 形分叉：

```js
import { line, curveBumpY } from 'd3-shape';

const branchCurve = line()
  .x(d => d.x)
  .y(d => d.y)
  .curve(curveBumpY);

const pathD = branchCurve([
  { x: mainAxisX, y: splitY },
  { x: branchAxisX, y: splitY + 60 }
]);
// 将 pathD 交给 Rough.js 渲染为手绘风格
```

### 6.4 轴线生长动画

首次加载时轴线从上往下"画出来"：
- Rough.js 输出多段 path
- 对每段 path 设置 `stroke-dasharray` = 总长度，`stroke-dashoffset` = 总长度
- GSAP stagger 动画递减 dashoffset → 0（线条逐渐显现）
- 普通增删改和模式切换不重复整页生长，改为随视觉事务交叉淡化；只有首次加载或新建轴执行 stroke-dashoffset 生长

---

## 七、动画系统（SOP）

### 7.1 GSAP 作为唯一动画引擎

GSAP v3.15.0 + ScrollTrigger + Timeline。GSAP skills 已安装（8 个 skill 文件）。

纯 CSS transition 仅用于极简场景（如 hover opacity 变化），其余一律 GSAP。

### 7.2 动画清单

| # | 动画 | GSAP 工具 | 触发条件 |
|---|------|-----------|----------|
| 1 | 纸张老化背景更新 | Timeline opacity 交叉淡化 | 内容/布局变化 |
| 2 | 节点入场 | ScrollTrigger + stagger | 节点进入视口 |
| 3 | 浮层展开 | Timeline | 点击节点 |
| 4 | 浮层收起 | timeline.reverse() | 点击关闭/背景 |
| 5 | 轴线生长 | stagger + stroke-dashoffset | 首次加载 |
| 6 | 里程碑展开 | Timeline（横向扩展 + 淡入） | 滚动到里程碑 |
| 7 | 筛选切换 | fadeOut/fadeIn 编排 | 点击筛选 chip |
| 8 | 模式切换 | 节点位置重排 | 点击模式 toggle |
| 9 | 轴出现/消失 | width/opacity 过渡 | 时间段变化 |
| 10 | 完整视觉事务 | 单一 Timeline，400ms | 增删改/模式/轴顺序变化 |

### 7.3 hover 交互

不变色，物理反馈：
```js
// 节点 hover
gsap.to(node, { scale: 1.01, boxShadow: '0 4px 12px rgba(44,36,22,0.08)', duration: 0.2 });
// 或纯 CSS transition（足够简单，不必引入 GSAP）
```

---

## 八、数据方案

### 8.1 存储架构

| 层 | 技术 | 存什么 |
|----|------|--------|
| 元数据 | Cloudflare D1 | 轴定义、事件信息、关联关系 |
| 媒体文件 | Cloudflare R2 | 图片、视频原文件 |
| API | luckyrong-router Worker | CRUD + 上传 + 认证 |

### 8.2 数据库 Schema

```sql
CREATE TABLE timeline_axes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_axis_id INTEGER REFERENCES timeline_axes(id) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  merge_axis_id INTEGER REFERENCES timeline_axes(id) ON DELETE SET NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_timeline_axes_one_primary
ON timeline_axes(is_primary) WHERE is_primary = 1;

CREATE TABLE timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('entry','milestone')),
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  event_date TEXT NOT NULL,
  color TEXT,
  media TEXT NOT NULL DEFAULT '[]',
  cover_media_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE timeline_event_axes (
  event_id INTEGER NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  axis_id INTEGER NOT NULL REFERENCES timeline_axes(id) ON DELETE RESTRICT,
  PRIMARY KEY (event_id, axis_id)
);
```

- migration `0002_primary_axis_and_order.sql` 将“我们”升级为唯一主轴，并把既有 `sort_order` 归一化为连续的 `0..n-1`
- migration `0003_entry_type_and_cover.sql` 将非里程碑事件统一迁移为 `entry`，保留全部轴关联，并从既有媒体清单首项初始化封面
- 轴顺序必须整组提交，Worker 使用 D1 `batch()` 原子更新全部轴，避免局部失败留下重复或断裂顺序

### 8.3 API 路由

| 方法 | 路由 | 说明 | 认证 |
|------|------|------|------|
| GET | /timeline/api/axes | 获取所有轴 | 无 |
| POST | /timeline/api/axes | 新建轴 | JWT |
| PUT | /timeline/api/axes/order | 原子保存全部轴的画面顺序 | JWT |
| PUT | /timeline/api/axes/:id | 编辑轴 | JWT |
| DELETE | /timeline/api/axes/:id | 删除轴 | JWT |
| GET | /timeline/api/events | 获取事件（分页，按日期倒序） | 无 |
| POST | /timeline/api/events | 新增事件 | JWT |
| PUT | /timeline/api/events/:id | 编辑事件 | JWT |
| DELETE | /timeline/api/events/:id | 删除事件 | JWT |
| POST | /timeline/api/upload | 上传媒体到 R2 | JWT |
| GET/HEAD | /timeline/api/media/:key | 读取媒体，支持 Range | 无 |
| POST | /timeline/api/login | 验证密码，签发 JWT | 无 |
| GET | /timeline/api/session | 验证现有 JWT | JWT |

### 8.4 认证流程

```
用户点击编辑按钮
  → 检查 localStorage 中是否有有效 JWT
    → 有 → 直接进入编辑模式
    → 无 → 弹出密码输入框
      → 输入密码 → POST /timeline/api/login
        → Worker 比对 env.TIMELINE_PASSWORD
          → 通过 → 签 JWT（30天有效）→ 返回前端存 localStorage
          → 失败 → 提示错误
```

---

## 九、技术栈

| 层 | 方案 | 版本/体积 |
|----|------|-----------|
| 框架 | Astro + React island（`client:visible`） | Astro 5 |
| 动画 | GSAP + ScrollTrigger + Timeline | v3.15.0 |
| 轴线渲染 | Rough.js | <9KB |
| 路径计算 | d3-shape / d3-path | ~5KB |
| 照片 lightbox | GLightbox | ~6KB |
| 手写字体 | Caveat | Google Fonts |
| 衬线字体 | Instrument Serif | 自托管 woff2 |
| 后端 | Cloudflare Worker（luckyrong-router） | — |
| 数据库 | Cloudflare D1 | — |
| 媒体存储 | Cloudflare R2 | — |
| 部署 | CF Pages（luckyrong 项目 /timeline 路由） | — |

---

## 十、文件结构（当前）

```
timeline/                              # 独立公开 GitHub 仓库与 Pages 项目
├── migrations/                       # D1 schema 与主轴/顺序 migration
├── src/
│   ├── pages/index.astro             # 页面入口，base=/timeline
│   ├── components/timeline/          # React UI、布局、API、排序与测试
│   └── styles/timeline.css           # 色温变量、纸张纹理与组件样式
├── public/fonts/                     # Instrument Serif 自托管字体
├── public/textures/                  # 预加载、可平铺的纸浆、颗粒与纤维
├── wrangler.jsonc                    # Cloudflare Pages 配置
├── wrangler.d1.jsonc                 # 独立 D1 migration 配置
└── package.json

luckyrong/
└── workers/
    ├── router.js                     # /timeline 页面与 API 路由
    └── timeline-api.js               # D1/R2 CRUD、认证与顺序保存
```

---

## 十一、实施规则

### 11.1 质量标准

- 直接做成品，不做 demo/prototype
- 不先砍功能再加回来
- 颜色支持自定义指定（轴颜色、节点颜色等）
- GSAP 应用尽用，在最擅长/最好看的地方用
- 所有技术决策以最终视觉/交互质量为导向

### 11.2 性能约束

- 同时只有 1 个浮层激活（GPU 合成层 < 2MB）
- `will-change` 仅动画期间添加
- 兼容集显轻薄本（Intel Iris Xe 级别）
- 目标 FPS：桌面 60fps，iPhone 16 60fps

### 11.3 兼容性

- 桌面：Chrome/Edge/Safari 最新版
- 移动：iPhone 16 Safari（仅浏览，不做响应式布局）
- 不兼容：老版本浏览器、Android、低端设备

---

## 十二、Skills 工作流（SOP）

### 12.1 已安装 Skills 清单

| 类别 | Skill 名称 | 用途 |
|------|-----------|------|
| 动画引擎 | gsap-core, gsap-react, gsap-scrolltrigger, gsap-timeline, gsap-plugins, gsap-frameworks, gsap-performance, gsap-utils | GSAP 技术参考，写动画代码时自动查阅 |
| 动效设计 | motion-design | 动效原则：timing/easing/choreography/Disney 原则/情绪映射 |
| 设计工程 | emil-design-eng | Emil Kowalski 的设计工程标准 |
| 动画审计 | review-animations | 审计已有动画的质量（easing、duration、性能） |
| 动画改进 | improve-animations | 生成动画改进计划（含 AUDIT.md + PLAN-TEMPLATE.md） |
| 动画发现 | find-animation-opportunities | 扫描代码，发现应该加动画但没加的地方 |
| 动画词汇 | animation-vocabulary | 动画命名和描述的统一术语 |
| 原型变体 | prototype | 对 UI 细节出 3-5 个方向变体，picker 切换对比 |
| 视觉设计 | claude-design | HTML 高保真视觉设计（含引导式问答 + 方向建议） |
| UI 库选型 | pick-ui-library | 根据需求推荐 UI 组件库 |
| Apple 设计 | apple-design | Apple HIG 设计参考 |

### 12.2 实现阶段：参考流程

写每个组件的动画代码时，按以下顺序利用 skills：

1. **确定情绪意图** — 查阅 `motion-design` 的 emotion-mapping（情绪 → 动效参数表）
2. **选择 Motion Personality** — 本项目选 **Premium**（elegant, minimal, sophisticated）：
   - Duration: 350-600ms
   - Easing: `cubic-bezier(0.4, 0, 0.2, 1)`
   - Overshoot: 0%
3. **查参数** — `motion-design` 的 duration table + easing selection 确定具体值
4. **写代码** — 参考 `gsap-*` skills 的最佳实践（useGSAP hook、ScrollTrigger 配置、Timeline 编排、性能优化）
5. **三层检查** — 每个动画必须有 primary + secondary + ambient 三层（`motion-design` core philosophy）

### 12.3 审计阶段：质量把控

每完成一个功能模块（如轴线渲染、节点浮层、色温系统），运行审计：

#### 步骤 1：review-animations

审计已写动画的技术质量：
- easing 方向是否正确（entrance = ease-out, exit = ease-in）
- duration 是否匹配元素类型（参考 duration table）
- 是否只动 `transform` + `opacity`（GPU 合成友好）
- `will-change` 是否仅动画期间添加
- reduced-motion 是否处理

#### 步骤 2：improve-animations

对 review 发现的问题生成改进计划：
- 输出 AUDIT.md（问题清单 + 严重度）
- 输出 PLAN（具体修改方案 + 代码片段）

#### 步骤 3：find-animation-opportunities

扫描完成的页面，检查遗漏：
- 有没有应该加动画但没加的交互（feedback gaps、teleporting state）
- 输出机会表（location / purpose / frequency / suggested motion）
- 同时输出 rejected candidates（说明为什么不加）— 防止过度动画

### 12.4 讨论阶段：设计决策

遇到 UI 细节拿不定主意时（某个组件的视觉/交互方案），使用：

#### prototype（变体对比）

适用场景：
- 节点卡片的展开动画风格（从下浮入 vs 从中心放大 vs 从轴线方向滑入）
- 工具托盘的毛玻璃效果（轻薄 vs 浓厚 vs 有色调偏移）
- 里程碑的视觉呈现（全宽色块 vs 内嵌装饰 vs 分割线强调）

流程：
1. 描述要探索的 UI 部件
2. 自动生成 3 个方向各异的变体（非微调，是真正不同的设计方向）
3. 通过 picker 在浏览器中实时切换对比
4. 选定后集成到项目，删除原型文件

#### claude-design（视觉探索）

适用场景：
- 页面整体调性验证（纸张质感 + 墨水色 + 布局的组合效果）
- 工具托盘的完整视觉设计
- 某个状态页面的视觉方案（空状态、加载态、错误态）

流程：
1. 描述需求 → skill 会问 8-10 个聚焦问题（输出格式、保真度、变体数量、调性）
2. 如果方向太模糊，自动进入 Design Direction Advisor 模式（从 10 种设计哲学中选 3 个方向展示）
3. 选定方向后输出 HTML 高保真原型
4. 迭代微调直到满意

### 12.5 Brand Motion Identity（本项目）

根据 `motion-design` 的 Brand Motion Identity 框架，本项目定义：

| 常量 | 值 | 依据 |
|------|-----|------|
| Signature easing | `cubic-bezier(0.4, 0, 0.2, 1)` | Premium archetype，优雅不急促 |
| Duration palette | quick: 200ms / standard: 400ms / slow: 600ms | Premium 范围 350-600ms |
| Entrance pattern | translateY(20px) + opacity:0 → settled，ease-out | 纸面浮现的统一方式 |

**例外**：
- ScrollTrigger scrub 动画不受 duration 限制（由滚动速度决定）
- hover 反馈用 quick (200ms) 而非 standard
- 轴线生长用 slow (600ms) + stagger

---

## 十三、确认状态

- [x] R2 bucket：`timeline-media`，Worker 绑定 `TIMELINE_MEDIA`
- [x] 初始轴：我们 / 我 / 她 / 旅行 / 日常 / 里程碑 / 异地
- [x] 初始轴色已写入 `0001_init.sql`，后续可在轴管理中自定义
- [ ] 里程碑节点的具体视觉样式微调
- [x] 托盘采用固定底部居中的毛玻璃圆角条，不可拖动
- [x] “我们”为唯一主轴：固定居中、加粗、不可删除或设置生命周期
