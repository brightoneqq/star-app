# Node.js + SQLite 内容迁移（nodejs-sqlite-migration）— 需求文档

## 概述

把当前纯静态站点升级成 **Node.js（Express）+ SQLite 内容后端**。SQLite 是"内容仓库"，**只装**现在写死在 `js/manifest.js` 里的 books / units 元数据，**不存**任何用户运行时状态。学习状态（quiz 分数、starred、streak、active days）继续走 localStorage / cookie。前端依然严格 ES5、无构建、无框架，新增的 API 调用走 `XMLHttpRequest` + callback。部署形态跟现在一样：父母电脑上跑、孩子 iPad 同 Wi-Fi 访问。

## 用户故事

- **作为项目维护者**，我想通过编辑 SQLite（用 DB Browser 或 sqlite3 CLI）来增删改 unit 列表，从而不再手动改 `manifest.js`，也方便后续扩展 schema。
- **作为项目维护者**，我希望 SQLite 的内容能被 git review，从而避免 binary 文件 diff 看不出改了什么。
- **作为小用户**（孩子），首页打开、unit 打开、重点集打开后看到的内容和功能跟现在**完全一致**，我的所有学习进度（star、quiz 分数、streak）一个都不能丢、一个都不变化。
- **作为项目维护者**，我希望启动方式保持"双击 startup.sh"的简洁体验，从而不需要记住一长串 npm 命令。

## 功能需求

### 后端：Node.js + Express

- [ ] 用 **Node.js 22+** 跑 Express，依靠原生 `node:sqlite` 模块（启动加 `--experimental-sqlite` flag）查 SQLite，**不引入** sqlite3 / better-sqlite3 / Kysely / Prisma 等第三方驱动。
- [ ] `npm install` 后唯一的运行时依赖是 `express`。
- [ ] Express 同一进程同时承担 **静态资源 server**（替代 `python3 -m http.server`）和 **API server**（提供 `/api/*`），共用端口 8000，bind `0.0.0.0` 以便 iPad 在 LAN 用 IP 访问。
- [ ] 静态资源根目录是项目根（`/index.html`、`/style/*`、`/js/*`、`/units/**`、`/review/*` 等）。
- [ ] 启动时如果 `data/star.db` 不存在，自动从 `data/seed.sql` 重建（见数据库段）。

### API

- [ ] **`GET /api/manifest`** — 返回完整 books → units 树，JSON 形如：
  ```json
  {
    "books": [
      {
        "id": "book1",
        "title": "Book 1 · 课本一",
        "units": [
          { "slug": "u3", "number": "U3", "title": "Unit 3", "cardCount": 32, "blankCount": 180 },
          ...
        ]
      },
      ...
    ]
  }
  ```
  字段结构和现在 `window.MYSTAR_MANIFEST` **完全一致**（前端零结构改动）。
- [ ] 排序：books 按 `books.sort_order` ASC，units 按 `units.sort_order` ASC。仅返回 `enabled = 1` 的行。
- [ ] 内容静态、不依赖请求参数：响应头加 `Cache-Control: no-cache, must-revalidate`（保证改完 db 立刻能看到，简化心智）。
- [ ] HTTP 5xx 时响应体为 `{ "error": "<message>" }`，前端据此显示加载失败提示（见前端段）。
- [ ] **不**实现 POST / PUT / DELETE。内容编辑统一通过 sqlite3 CLI / DB Browser 直接改 `.db`。
- [ ] **强不变式**：server 永远不读、不写任何 localStorage / cookie 相关的 user-state key（`starredCards_*` / `lastVisit_*` / `quizScore_*` / `mystar_active_days`）。也**不**提供任何暴露用户状态的 endpoint。如果未来想加，必须先开新 spec。

### 数据库

- [ ] SQLite 文件路径：`data/star.db`。**不入 git**（在 `.gitignore`）。
- [ ] **Source of truth 是 `data/seed.sql`**，纯 SQL 文本，入 git。文件含完整 schema (CREATE TABLE) + 全量当前内容的 INSERT 语句。
- [ ] 启动流程：Node 启动前检查 `data/star.db` 存在性。**不存在** → 用 `node:sqlite` 打开新 `.db` 文件，逐行 exec `seed.sql`；**存在** → 直接打开。
- [ ] 提供 `npm run dump` 脚本：从当前 `.db` 导出 `data/seed.sql`（覆盖旧的），方便维护者改完 db 后同步回 seed。**人工触发**，不进 git hook（避免 hook 噪音）。
- [ ] dump 输出**顺序稳定**：books 按 `sort_order, id` 排，units 按 `book_id, sort_order, slug` 排，保证两次相同状态 dump 出来的 seed.sql 内容字节一致（git diff 才有意义）。
- [ ] 当前 `js/manifest.js` 的全部内容（书 + Unit 3 + Unit 6）必须被 seed.sql 完整覆盖，并经过比对验证一致。

### Schema

- [ ] **books** 表：
  - `id` TEXT PRIMARY KEY（如 `book1`）
  - `title` TEXT NOT NULL（如 `Book 1 · 课本一`）
  - `sort_order` INTEGER NOT NULL DEFAULT 0
  - `enabled` INTEGER NOT NULL DEFAULT 1（SQLite 没 BOOLEAN）
- [ ] **units** 表：
  - `slug` TEXT PRIMARY KEY（如 `u3` —— 在整个 db 内全局唯一，跟现在 storage key `starredCards_<slug>` 假设一致）
  - `book_id` TEXT NOT NULL REFERENCES books(id)
  - `number` TEXT NOT NULL（如 `U3`）
  - `title` TEXT NOT NULL（如 `Unit 3` 或 `Unit 6 · Famous people in history`）
  - `card_count` INTEGER NOT NULL
  - `blank_count` INTEGER NOT NULL
  - `sort_order` INTEGER NOT NULL DEFAULT 0
  - `enabled` INTEGER NOT NULL DEFAULT 1
- [ ] **索引**：`CREATE INDEX idx_units_book_order ON units(book_id, sort_order)`。
- [ ] 字段名在 API 响应里转回 camelCase（`card_count` → `cardCount`，`blank_count` → `blankCount`），保持前端零改动。

### DB 查询封装（用户原话："自己封装查询"）

- [ ] **函数库风格**，不引入 query builder：
  ```js
  // server/db.js（CommonJS 即可；server 侧允许现代 JS）
  function listBooksEnabled()     { ... }
  function listUnitsEnabled()     { ... }  // 跨 book，返回时按 (book_id, sort_order) 排序
  function getManifest()          { ... }  // 组合上面两个，组装成 API 响应形状
  ```
- [ ] 所有 SQL 必须用 `node:sqlite` 的 prepared statement + `bind` 参数化，不允许字符串拼接。
- [ ] 每个查询封装函数在 `server/db.js` 内部 prepare 一次、重复使用（避免 hot path 重复 prepare 开销）。
- [ ] 模块导出形如 `module.exports = { listBooksEnabled, listUnitsEnabled, getManifest }`，路由代码只调函数、不写 SQL。

### 前端：替换 manifest.js

- [ ] **`js/manifest.js` 删除**。`window.MYSTAR_MANIFEST` 不再是同步可用的全局变量。
- [ ] 在 `js/shared.js` 内（或新建 `js/manifest-loader.js`）添加 **ES5 工具函数**：
  ```js
  MyStar.loadManifest(callback)
  ```
  内部用 `XMLHttpRequest`（GET `/api/manifest`，readystate 4 + status 200 → 解析 JSON → `callback(null, manifest)`；否则 `callback(err)`）。**禁止 fetch / Promise / arrow / const/let**。
- [ ] **`index.html`** 和 **`review/index.html`** 的入口改成：先 `MyStar.loadManifest(cb)`，回调里再 `render(manifest)`。
- [ ] 加载期间显示**加载占位文案**（首页用 `<div id="books">加载中…</div>`，沿用现有 DOM 结构）。
- [ ] 加载失败显示**错误提示** + 重试按钮（按钮触发再次调用 `MyStar.loadManifest`）。文案：「内容加载失败，检查服务后重试」。**重试按钮必须用 `MyStar.addTapListener` 绑定**（沿用 AGENTS.md 第 3 条规则，不用 `onclick=` / raw `addEventListener('click')`）。
- [ ] XHR **超时 10 秒** 视为失败，触发上面的失败 UI（使用 `xhr.timeout = 10000` + `xhr.ontimeout`）。
- [ ] 前端**不缓存** manifest（同上 API Cache-Control）。每次刷新都重拉。

### 启动 / 部署

- [ ] 保留 `startup.sh` 入口，改写为：
  ```bash
  #!/usr/bin/env bash
  # 1. 确认 Node 版本 >= 22（不满足直接报错退出）
  # 2. 如果 node_modules 不存在或 package-lock 过期 → npm install
  # 3. node --experimental-sqlite server.js
  ```
  保留 trap cleanup，保留 PORT env override（默认 8000）。
- [ ] `package.json`：
  - `engines.node` 至少 `>= 22.0.0`
  - `scripts.start`: `node --experimental-sqlite server.js`
  - `scripts.dump`: 一个简短的 node 脚本，从 `data/star.db` 导出 `data/seed.sql`
  - `dependencies`: 仅 `express`
- [ ] **不引入** pm2 / systemd / docker。家庭场景按需手动启停足够。

## 边界情况与错误处理

| 场景                                        | 期望行为                                                                 |
|---------------------------------------------|--------------------------------------------------------------------------|
| 启动时 `data/star.db` 不存在                | 从 `data/seed.sql` 自动重建，控制台打印 `built data/star.db from seed`   |
| 启动时 `data/seed.sql` 也不存在             | 启动失败 + 控制台报 `missing both db and seed`，非零 exit               |
| 启动时 Node 版本 < 22                       | startup.sh 直接拒绝启动，提示 `Node 22+ required`，非零 exit            |
| API `/api/manifest` 数据库出错              | 返回 HTTP 500 + `{ "error": "..." }`，前端显示"加载失败"+重试           |
| 前端 XHR 网络断或 timeout                   | 同上，显示加载失败 + 重试                                               |
| 前端启动后 API 返回 books=[]                | 不报错，渲染空首页（沿用现有"无内容时不崩"行为）                       |
| 维护者改完 .db 没跑 `npm run dump`          | git 上的 seed.sql 跟 .db 不一致；下次 fresh checkout 重建会丢改动。     |
|                                             | **靠维护者纪律 + README 提示**，本期不做自动 hook                       |
| 同一个 slug 在 db 里出现两次                | UNIQUE constraint 阻止 INSERT；维护者改 .db 时会立刻看到错误            |
| `enabled = 0` 的 unit                       | 不进 API 响应，前端完全看不到（首页、重点集、streak 计算都跳过）        |

## 数据模型

```sql
CREATE TABLE books (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE units (
    slug        TEXT PRIMARY KEY,
    book_id     TEXT NOT NULL REFERENCES books(id),
    number      TEXT NOT NULL,
    title       TEXT NOT NULL,
    card_count  INTEGER NOT NULL,
    blank_count INTEGER NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE INDEX idx_units_book_order ON units(book_id, sort_order);

-- 当前 manifest.js 的 seed:
INSERT INTO books (id, title, sort_order) VALUES ('book1', 'Book 1 · 课本一', 0);
INSERT INTO units (slug, book_id, number, title, card_count, blank_count, sort_order) VALUES
  ('u3', 'book1', 'U3', 'Unit 3', 32, 180, 0),
  ('u6', 'book1', 'U6', 'Unit 6 · Famous people in history', 33, 192, 1);
```

## 界面与交互规范

前端**视觉零变化**。唯一新增的状态是：

- **加载中**：首页 `#books` 容器、review 页 `#review-content` 容器渲染前显示 `加载中…`（与现有 review 加载占位文案风格一致）。
- **加载失败**：渲染一个简单 panel：「内容加载失败，检查服务后重试」+ 一个胶囊按钮「重试」。按钮触发 `MyStar.loadManifest(cb)` 再次。
- 海军色板继续严格遵守 `spec-workflow/steering/conventions/colors.md`。新增 panel 的颜色使用 `var(--accent-amber-soft)` 背景 + `var(--ink)` 文字 + `var(--accent-amber)` 按钮，**不引入新硬编码 hex**。

## 依赖与集成

**新增 / 修改的文件（预期）：**
- `package.json`、`package-lock.json`（新）
- `server.js`（新，Express + node:sqlite + /api/manifest）
- `server/db.js`（新，DB 查询函数库）
- `scripts/dump.js`（新，`npm run dump` 实现）
- `data/seed.sql`（新，schema + 当前内容种子）
- `data/star.db`（运行时生成，**在 .gitignore**）
- `startup.sh`（改写为直接 `node --experimental-sqlite server.js`，**不**走 npm wrapper）
- `js/shared.js`（追加 `MyStar.loadManifest` ES5 工具）
- `style/shared.css`（追加 `.load-fail` 失败 UI 样式；颜色全部用 colors.md token，不引入新硬编码 hex）
- `index.html`、`review/index.html`（入口改异步加载 + 新增 showError / 重试按钮）
- `js/manifest.js`（**删除**）
- `.gitignore`（追加 `node_modules/`、`data/star.db` 及 journal/wal/shm 文件）
- `AGENTS.md`（更新 "no package.json" 过时描述 + 加 Data/DB 段）
- `README.md`（新增 Run locally / Editing content 段）
- `spec-workflow/steering/structure.md`（追加 server/、data/、scripts/ 目录说明 + 一条 anti-pattern）
- `spec-workflow/steering/tech.md`（Stack 段 / Architectural decisions 同步）
- `spec-workflow/specs/nodejs-sqlite-migration/{requirements,design,tasks}.md`（本 spec 流程产物，作为 commit 范围一并入 git）

**不动的文件：**
- `units/**/index.html`（unit 内容本期不入库）
- `js/unit-enhance.js`、`style/unit-enhance.css`
- `spec-workflow/steering/product.md`（产品定位不变）
- `spec-workflow/steering/conventions/colors.md`（继续作为色板 source of truth）

**第三方依赖：**
- Express（运行时唯一第三方依赖）
- Node.js 22+（运行时环境前置条件，原生 `node:sqlite`）

## 假设清单（请确认）

1. **维护者的本机有 Node 22+**。如果没有，需先自行升级。
2. **`--experimental-sqlite` flag 的稳定性**：在 Node 22.x 这是 stable 的实验特性。如果未来变 unstable 或者要的 flag 名字变了，迁回 better-sqlite3 是后备路径（小工作量）。
3. **DB 编辑工作流靠维护者纪律**：改完 db 必须 `npm run dump` 同步 seed.sql；忘了同步的话下次 fresh checkout 会丢改动。本期不做自动 hook、不做强制校验。
4. **review/index.html 现存的 `fetch` + `Promise.all` + arrow function**（用于拉 unit HTML 提取重点卡片）**不在本期改造范围**。它跟严格 ES5 约束有历史 inconsistency，但属于"已经在跑"的代码，老 iPad 实测看是否 OK 决定是否后续重构。本期新增的 API 调用必须走 XHR + callback。
5. **manifest 缓存**：选择 no-cache，每次刷新都拉，简化心智。如果 LAN 慢可优化但非本期。
6. **slug 全局唯一**：现在 storage key 是 `starredCards_<slug>`、跨 book 不带 book_id，意味着 slug 必须全 db 唯一。schema 里 `units.slug` 设为 PRIMARY KEY 即可。
7. **api 响应大小**：当前 books=1 / units=2，未来加到 100 个 unit 也才几 KB；不分页、一次返回。
8. **CORS / Cookie**：API 跟前端同源同端口，无需 CORS；现有 localStorage / cookie 全部不受影响。
9. **静态资源 Cache-Control**：由 Express 默认行为决定，本期不细调。
10. **HTTPS**：本期纯 HTTP（家庭 LAN）。

## 未决问题

- 无关键阻塞项。任一假设要改，design 阶段说明即可。

## 不在范围内

- 用户体系、登录、多用户、多角色
- 跨设备同步用户运行状态（quiz 分数等仍 100% localStorage）
- Unit 卡片内容入库（仅 books / units 元数据入库，卡片继续在 unit HTML）
- 后台 admin Web UI（DB 编辑通过 sqlite3 CLI / DB Browser）
- 前端框架重写（Vue / React / build pipeline / TypeScript）
- 测试 / lint / CI 工具链
- Docker / pm2 / systemd 进程管理
- 上云部署、HTTPS、鉴权
- 学习数据分析报表（与 SQLite 无关，本期不要）
- 老师 / 家长视图
- `review/index.html` 内部 fetch+Promise 的 ES5 化重构
- 任何对色板的改动
