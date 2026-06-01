# Node.js + SQLite 内容迁移 — 设计文档

> 配套需求：`spec-workflow/specs/nodejs-sqlite-migration/requirements.md`
> 配套约定：`spec-workflow/steering/conventions/colors.md`、`AGENTS.md`

## 1. 概述

把 `python3 -m http.server` 换成 **Express + node:sqlite** 进程：同端口（8000）同时 serve 静态资源和 `/api/manifest`。SQLite 文件 `data/star.db` 是 books / units 元数据的运行时副本，**不入 git**；`data/seed.sql` 是入 git 的 single source of truth。前端 ES5 严格不变，新增的 `MyStar.loadManifest(callback)` 走 `XMLHttpRequest`，10s timeout，失败可重试。所有用户状态继续 localStorage —— server 不读、不写任何 storage key。

## 2. 总体架构

```mermaid
flowchart LR
    subgraph Client (iPad Safari, ES5)
        IDX[index.html] --> LM[MyStar.loadManifest]
        REV[review/index.html] --> LM
        LM -- XHR --> EXP
        IDX --> LS[(localStorage / cookie)]
        REV --> LS
    end

    subgraph Server (Node 22+, single process)
        EXP[Express :8000]
        EXP -- /api/manifest --> ROUTE[routes/api.js]
        ROUTE --> DB[server/db.js]
        DB --> SQLITE[(data/star.db)]
        EXP -- static --> FILES[index.html, js/, style/, units/, review/]
    end

    SEED[data/seed.sql<br/>(git tracked)] -. boot rebuild .-> SQLITE
```

**关键不变式：**

1. server 不存在任何代码读写 `starredCards_*` / `lastVisit_*` / `quizScore_*` / `mystar_active_days`。grep 这些 token 在 `server/**` 必须 0 结果。
2. SQLite 仅含 books / units 两张表。schema 范围 enforced by seed.sql。
3. 前端模块加载顺序：`shared.js` 提供 loadManifest → 页面 inline script 调它 → 拿到 manifest 后执行原有 render。`manifest.js` 文件不再存在。

## 3. 文件树（终态）

```
star-app/
├── AGENTS.md                       (不动)
├── README.md                       (建议改一行说明启动方式 — 见 §10)
├── package.json                    [新]
├── package-lock.json               [新，npm install 生成]
├── startup.sh                      [改写]
├── server.js                       [新] — Express 入口
├── server/
│   └── db.js                       [新] — node:sqlite 封装
├── data/
│   ├── seed.sql                    [新，入 git]
│   └── star.db                     [新，运行时生成，.gitignore]
├── scripts/
│   └── dump.js                     [新] — npm run dump 的实现
├── .gitignore                      [改] — 追加 node_modules/, data/star.db
│
├── index.html                      [改] — 入口异步加载
├── review/index.html               [改] — 入口异步加载
├── js/
│   ├── shared.js                   [改] — 追加 MyStar.loadManifest
│   ├── unit-enhance.js             (不动)
│   └── manifest.js                 [删]
├── style/                          (不动)
├── units/                          (不动)
└── spec-workflow/                  (不动 / 含本 spec)
```

## 4. 后端

### 4.1 package.json

```json
{
  "name": "star-app",
  "version": "1.0.0",
  "private": true,
  "description": "myStar · 课间复习 — Express + SQLite content backend.",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "start": "node --experimental-sqlite server.js",
    "dump": "node --experimental-sqlite scripts/dump.js"
  },
  "dependencies": { "express": "^4.19.0" }
}
```

> 写死 `--experimental-sqlite`。Node 22.x 必须；Node 23+ flag 已 deprecated 但仍接受（会有 ExperimentalWarning，可忽略）。若未来需要去 flag，改这两行即可。

### 4.2 server.js（CommonJS，约 60 行）

```js
'use strict';

var path = require('path');
var fs = require('fs');
var express = require('express');
var db = require('./server/db');

var PORT = Number(process.env.PORT) || 8000;
var HOST = '0.0.0.0';                       // 让 iPad 在 LAN 内能访问
var ROOT = path.resolve(__dirname);

// --- DB boot: build star.db from seed.sql if missing ---------------------
db.ensureDb({
    dbPath:   path.join(ROOT, 'data/star.db'),
    seedPath: path.join(ROOT, 'data/seed.sql')
});

var app = express();

// --- Deny middleware (block server source, db, build scripts from LAN) ---
// express.static(ROOT) would otherwise expose data/seed.sql, server/db.js,
// scripts/dump.js, package*.json to anyone on the Wi-Fi. Lock them down.
app.use(function (req, res, next) {
    var p = req.path;
    if (/^\/(data|server|scripts|node_modules)(\/|$)/.test(p) ||
        /^\/package(-lock)?\.json$/i.test(p) ||
        /^\/\.(gitignore|git\/|claude\/|env)/i.test(p)) {
        return res.status(404).send('Not found');
    }
    next();
});

// --- API routes (MUST come before static so /api/* doesn't get swallowed
//     by express.static fallthrough — note: express.static only matches
//     existing files anyway, so order is defense in depth.) -------------
app.get('/api/manifest', function (req, res) {
    try {
        var manifest = db.getManifest();
        res.set('Cache-Control', 'no-cache, must-revalidate');
        res.json(manifest);
    } catch (err) {
        console.error('[api/manifest] failed:', err);
        res.status(500).json({ error: String(err && err.message || err) });
    }
});

// --- Static files (everything else) -------------------------------------
// Disable index.html auto-resolve so we can keep explicit / behavior;
// or leave default — choose default for simplicity.
app.use(express.static(ROOT, {
    extensions: ['html'],
    setHeaders: function (res, filePath) {
        // Optional: HTML/JS get no-cache so dev cycle stays fast.
        if (/\.(html|js|css)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// --- Boot ----------------------------------------------------------------
app.listen(PORT, HOST, function () {
    console.log('star-app listening on http://' + HOST + ':' + PORT);
    console.log('LAN access: http://<this-machine-ip>:' + PORT);
});
```

**路由顺序原则**：先注册 `/api/*` 路由，再 `express.static`。express.static 只命中**真实存在的文件**，所以 `/api/manifest` 不会被静态匹配 fallthrough，但显式先注册是 defense in depth。

**HOST = 0.0.0.0**：要点。如果用 `127.0.0.1` iPad 拿不到。

### 4.3 server/db.js — DB 查询封装（约 70 行）

```js
'use strict';

var fs = require('fs');
var path = require('path');
var sqlite = require('node:sqlite');           // 需要 --experimental-sqlite

var dbInstance = null;
var stmtListBooks = null;
var stmtListUnits = null;

function ensureDb(opts) {
    var dbPath = opts.dbPath;
    var seedPath = opts.seedPath;

    var needsBuild = !fs.existsSync(dbPath);
    if (needsBuild) {
        if (!fs.existsSync(seedPath)) {
            throw new Error('missing both db and seed: ' + dbPath + ', ' + seedPath);
        }
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        var fresh = new sqlite.DatabaseSync(dbPath);
        var sql = fs.readFileSync(seedPath, 'utf8');
        fresh.exec(sql);
        fresh.close();
        console.log('built ' + dbPath + ' from seed');
    }

    dbInstance = new sqlite.DatabaseSync(dbPath);
    dbInstance.exec('PRAGMA foreign_keys = ON');

    // Prepare once, reuse forever.
    stmtListBooks = dbInstance.prepare(
        'SELECT id, title FROM books WHERE enabled = 1 ORDER BY sort_order, id'
    );
    stmtListUnits = dbInstance.prepare(
        'SELECT slug, book_id, number, title, card_count, blank_count ' +
        'FROM units WHERE enabled = 1 ORDER BY book_id, sort_order, slug'
    );
}

function listBooksEnabled() {
    if (!stmtListBooks) throw new Error('db not initialized');
    return stmtListBooks.all();
}

function listUnitsEnabled() {
    if (!stmtListUnits) throw new Error('db not initialized');
    return stmtListUnits.all();
}

/**
 * Assembles the API shape (snake_case → camelCase for cardCount/blankCount).
 * Matches the old window.MYSTAR_MANIFEST exactly.
 */
function getManifest() {
    var books = listBooksEnabled();
    var units = listUnitsEnabled();

    var byBook = {};
    for (var i = 0; i < units.length; i++) {
        var u = units[i];
        if (!byBook[u.book_id]) byBook[u.book_id] = [];
        byBook[u.book_id].push({
            slug:       u.slug,
            number:     u.number,
            title:      u.title,
            cardCount:  u.card_count,
            blankCount: u.blank_count
        });
    }

    var out = { books: [] };
    for (var j = 0; j < books.length; j++) {
        var b = books[j];
        out.books.push({
            id:    b.id,
            title: b.title,
            units: byBook[b.id] || []
        });
    }
    return out;
}

module.exports = {
    ensureDb:           ensureDb,
    listBooksEnabled:   listBooksEnabled,
    listUnitsEnabled:   listUnitsEnabled,
    getManifest:        getManifest
};
```

**设计要点：**

- **module-level prepared statement**：`stmtListBooks` / `stmtListUnits` 在 `ensureDb()` 里 prepare 一次，每次请求 `.all()` 复用，避免热路径重复 prepare。
- **DatabaseSync.exec(sql)**：seed.sql 直接 exec，因为 node:sqlite 支持 multi-statement exec。
- **PRAGMA foreign_keys = ON**：让 `units.book_id REFERENCES books(id)` 真的生效。
- **错误传播**：listX 抛 → server.js 路由层 catch → 500 + `{error}`。

### 4.4 data/seed.sql（完整内容）

```sql
-- nodejs-sqlite-migration : single source of truth for content tree.
-- Edit via: open data/star.db in sqlite3 CLI or DB Browser, then `npm run dump`
-- to regenerate this file. Or edit this file directly and delete data/star.db
-- to force a rebuild on next start.

PRAGMA foreign_keys = ON;

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

INSERT INTO books (id, title, sort_order, enabled) VALUES
  ('book1', 'Book 1 · 课本一', 0, 1);

INSERT INTO units (slug, book_id, number, title, card_count, blank_count, sort_order, enabled) VALUES
  ('u3', 'book1', 'U3', 'Unit 3', 32, 180, 0, 1),
  ('u6', 'book1', 'U6', 'Unit 6 · Famous people in history', 33, 192, 1, 1);
```

字段值与现有 `js/manifest.js` 一一对应。验证脚手架：见 §9 测试策略。

### 4.5 scripts/dump.js — `npm run dump` 实现

```js
'use strict';

var fs = require('fs');
var path = require('path');
var sqlite = require('node:sqlite');

var DB_PATH = path.resolve(__dirname, '../data/star.db');
var SEED_PATH = path.resolve(__dirname, '../data/seed.sql');

if (!fs.existsSync(DB_PATH)) {
    console.error('No db file at ' + DB_PATH + '. Nothing to dump.');
    process.exit(1);
}

var db = new sqlite.DatabaseSync(DB_PATH);

// Escape single quotes for SQL string literals. SQLite doesn't have
// E-strings, so '' is the only way.
function sqlStr(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return "'" + String(v).replace(/'/g, "''") + "'";
}

// Stable ordering = stable git diffs.
var books = db.prepare('SELECT id, title, sort_order, enabled FROM books ORDER BY sort_order, id').all();
var units = db.prepare(
    'SELECT slug, book_id, number, title, card_count, blank_count, sort_order, enabled ' +
    'FROM units ORDER BY book_id, sort_order, slug'
).all();

var out = [];
out.push('-- nodejs-sqlite-migration : single source of truth for content tree.');
out.push('-- Edit via: open data/star.db in sqlite3 CLI or DB Browser, then `npm run dump`');
out.push('-- to regenerate this file. Or edit this file directly and delete data/star.db');
out.push('-- to force a rebuild on next start.');
out.push('');
out.push('PRAGMA foreign_keys = ON;');
out.push('');
out.push('CREATE TABLE books (');
out.push('    id          TEXT PRIMARY KEY,');
out.push('    title       TEXT NOT NULL,');
out.push('    sort_order  INTEGER NOT NULL DEFAULT 0,');
out.push('    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))');
out.push(');');
out.push('');
out.push('CREATE TABLE units (');
out.push('    slug        TEXT PRIMARY KEY,');
out.push('    book_id     TEXT NOT NULL REFERENCES books(id),');
out.push('    number      TEXT NOT NULL,');
out.push('    title       TEXT NOT NULL,');
out.push('    card_count  INTEGER NOT NULL,');
out.push('    blank_count INTEGER NOT NULL,');
out.push('    sort_order  INTEGER NOT NULL DEFAULT 0,');
out.push('    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))');
out.push(');');
out.push('');
out.push('CREATE INDEX idx_units_book_order ON units(book_id, sort_order);');
out.push('');

if (books.length) {
    out.push('INSERT INTO books (id, title, sort_order, enabled) VALUES');
    var bookLines = books.map(function (b, i) {
        return '  (' + sqlStr(b.id) + ', ' + sqlStr(b.title) + ', ' +
               sqlStr(b.sort_order) + ', ' + sqlStr(b.enabled) + ')' +
               (i === books.length - 1 ? ';' : ',');
    });
    out = out.concat(bookLines);
    out.push('');
}

if (units.length) {
    out.push('INSERT INTO units (slug, book_id, number, title, card_count, blank_count, sort_order, enabled) VALUES');
    var unitLines = units.map(function (u, i) {
        return '  (' + sqlStr(u.slug) + ', ' + sqlStr(u.book_id) + ', ' +
               sqlStr(u.number) + ', ' + sqlStr(u.title) + ', ' +
               sqlStr(u.card_count) + ', ' + sqlStr(u.blank_count) + ', ' +
               sqlStr(u.sort_order) + ', ' + sqlStr(u.enabled) + ')' +
               (i === units.length - 1 ? ';' : ',');
    });
    out = out.concat(unitLines);
    out.push('');
}

fs.writeFileSync(SEED_PATH, out.join('\n'), 'utf8');
console.log('wrote ' + SEED_PATH + '  (' + books.length + ' books, ' + units.length + ' units)');
```

**byte-stable 保证：**
- 排序固定（books: sort_order, id；units: book_id, sort_order, slug）
- 文本字段单引号 escape 唯一
- 无时间戳、无随机 id
- 末尾换行固定（`.join('\n')`，没有末尾空行）

## 5. 前端

### 5.1 `MyStar.loadManifest(callback)` — ES5 XHR 草案

加在 `js/shared.js` 的 IIFE 内、`W.MyStar = {...}` 之前；导出到 MyStar 命名空间。

```js
// ---------- Manifest loader (XHR, ES5) -------------------------------
// callback(err, manifest)
//   - err === null on success, manifest = { books: [...] }
//   - err is an Error on network/parse/server failure; manifest is undefined
function loadManifest(callback) {
    var xhr = new XMLHttpRequest();
    var done = false;
    function finish(err, data) {
        if (done) return;
        done = true;
        callback(err, data);
    }
    try {
        xhr.open('GET', '/api/manifest', true);
        xhr.timeout = 10000;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status >= 200 && xhr.status < 300) {
                var parsed;
                try { parsed = JSON.parse(xhr.responseText); }
                catch (e) { finish(new Error('manifest parse failed: ' + e.message)); return; }
                if (!parsed || !parsed.books) {
                    finish(new Error('manifest shape invalid')); return;
                }
                finish(null, parsed);
            } else {
                finish(new Error('HTTP ' + xhr.status));
            }
        };
        xhr.ontimeout = function () { finish(new Error('timeout')); };
        xhr.onerror   = function () { finish(new Error('network error')); };
        xhr.send(null);
    } catch (e) {
        finish(e);
    }
}
```

加到导出对象：`W.MyStar = { ..., loadManifest: loadManifest };`

### 5.2 index.html 入口改造

**当前**：
```html
<script src="js/manifest.js"></script>
<script src="js/shared.js"></script>
<script>
  (function () {
      var M = window.MyStar;
      var manifest = window.MYSTAR_MANIFEST;     // <— 同步
      ...
      function boot() { ... }
      document.addEventListener('DOMContentLoaded', boot);
  })();
</script>
```

**改造后**：
```html
<script src="js/shared.js"></script>       <!-- manifest.js 删除 -->
<script>
  (function () {
      var M = window.MyStar;
      var manifest = null;                       // <— 加载后赋值

      // ... 所有 svg/render/pickRecommended 等函数定义不变 ...

      function showLoading() {
          document.getElementById('books').innerHTML = '<div class="empty-state"><div class="msg">加载中…</div></div>';
      }

      function showError() {
          var root = document.getElementById('books');
          root.innerHTML =
              '<div class="load-fail">' +
              '  <div class="lf-msg">内容加载失败，检查服务后重试</div>' +
              '  <button id="lfRetry" class="btn-pill primary">重试</button>' +
              '</div>';
          M.addTapListener(document.getElementById('lfRetry'), function () { boot(); });
      }

      function boot() {
          M.recordActiveDay();
          showLoading();
          M.loadManifest(function (err, data) {
              if (err) { console.warn('[home] manifest load failed:', err); showError(); return; }
              manifest = data;
              var all = gatherAllUnits();
              renderGuideRow(all);
              renderRecommend(all);
              renderBooks(all);
              refreshReviewLink();
          });
      }

      document.addEventListener('DOMContentLoaded', boot);
  })();
</script>
```

变化总结（diff 思路）：
1. 删除 `<script src="js/manifest.js"></script>`
2. `var manifest = null` 而不是直接从全局拿
3. `boot()` 内先 `showLoading()` → 调 `loadManifest` → 回调里 setp manifest + 执行原 render
4. 新增 `showLoading()` / `showError()` 两个函数
5. 其他渲染函数完全不变（`gatherAllUnits / renderGuideRow / renderRecommend / renderBooks / refreshReviewLink` 都依赖闭包里的 `manifest` 变量，赋值后自然可用）

### 5.3 review/index.html 入口改造

review 的入口结构类似 index.html，区别在于：
- 已经在用 `window.MYSTAR_MANIFEST` 同步访问（line 156）
- 同时也 fetch 每个 unit HTML 提取星标卡（这部分**本期不改**，见 requirements 假设清单 #4）

改造步骤：
1. 删 `<script src="../js/manifest.js"></script>`
2. 把 `var manifest = window.MYSTAR_MANIFEST;` 改成 `var manifest = null;`
3. 在 IIFE 内、`DOMContentLoaded` 之前，新增 review 版 `showError()`：
```js
function showError() {
    var root = document.getElementById('review-content');
    root.innerHTML =
        '<div class="load-fail">' +
        '  <div class="lf-msg">内容加载失败，检查服务后重试</div>' +
        '  <button id="lfRetry" class="btn-pill primary">重试</button>' +
        '</div>';
    M.addTapListener(document.getElementById('lfRetry'), function () {
        // Re-enter the full bootstrap (re-pull manifest, re-fetch all units).
        bootReview();
    });
}
```
4. 把原 `DOMContentLoaded` 回调里的内容抽到 `bootReview()`，外层包 loadManifest：
```js
function bootReview() {
    M.loadManifest(function (err, data) {
        if (err) { console.warn('[review] manifest load failed:', err); showError(); return; }
        manifest = data;
        // ↓ 原 DOMContentLoaded 内容（forEach + Promise.all + render — 历史遗留，
        //   本期不改，见 requirements 假设清单 #4）
        var jobs = [];
        manifest.books.forEach(function (book) {
            book.units.forEach(function (unit) { jobs.push(loadUnit(book, unit)); });
        });
        Promise.all(jobs).then(render);
    });
}
document.addEventListener('DOMContentLoaded', bootReview);
```

review 版 `showError` 与首页版**结构完全相同**（共用 `.load-fail` CSS），区别只在容器是 `#review-content`、重试入口是 `bootReview()` 而非首页的 `boot()`。重试按钮必须经 `MyStar.addTapListener` 绑定（同 requirements actionable fix）。

> 注意：review 内部 `forEach` / `Promise.all` / arrow function 是历史遗留，本 spec 假设清单 #4 明确不在本期改造范围。新增的 `M.loadManifest` + `showError` 调用走 ES5 + callback 风格、合规。

### 5.4 加载失败 UI — DOM / CSS

新增 `.load-fail` 块，加到 `style/shared.css`：

```css
.load-fail {
    margin: 24px auto;
    padding: 20px 24px;
    background: var(--accent-amber-soft);
    border: 2px solid var(--ink);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    text-align: center;
    max-width: 480px;
}
.load-fail .lf-msg {
    color: var(--ink);
    font-size: 1.05rem;
    font-weight: 700;
    margin-bottom: 16px;
}
.load-fail .btn-pill.primary {
    /* inherits from existing .btn-pill.primary (amber bg, ink text) */
    background: var(--accent-amber);
}
```

颜色全部走 `colors.md` token。无新硬编码 hex。

## 6. 启动 / 部署

### 6.1 startup.sh 改写

```bash
#!/usr/bin/env bash
# Start star-app (Express + SQLite).
# Closing this shell (Ctrl+C / terminal close) stops the server.
set -e

PORT="${PORT:-8000}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# --- Node version gate ---
if ! command -v node >/dev/null 2>&1; then
    echo "Error: node not found. Install Node.js 22+ first."
    exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
    echo "Error: Node 22+ required (found $(node -v))."
    exit 1
fi

# --- Install if needed ---
# Cover: (a) fresh checkout, no node_modules
#        (b) package.json updated (deps added)
#        (c) package-lock.json updated (after git pull, lock changed but
#            package.json may not have)
if [ ! -d node_modules ] \
   || [ package.json -nt node_modules ] \
   || [ package-lock.json -nt node_modules ]; then
    echo "Installing dependencies..."
    npm install --no-audit --no-fund
fi

# --- Run ---
# IMPORTANT: launch node directly (not `npm start`) so SERVER_PID is the
# Express process itself. If we used `npm start &`, $! would be the npm
# wrapper; killing it doesn't propagate to the forked Node child, which
# would orphan the server and keep port 8000 occupied.
cleanup() {
    if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo
        echo "Stopping server (PID $SERVER_PID)..."
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM HUP

echo "Serving $ROOT"
echo "Open http://localhost:$PORT  (LAN: http://<ip>:$PORT)"
echo "Press Ctrl+C (or close this terminal) to stop."
echo

PORT="$PORT" node --experimental-sqlite server.js &
SERVER_PID=$!
wait "$SERVER_PID"
```

要点：
- 拒绝 < Node 22
- 触发 `npm install` 的三个条件：缺 node_modules / package.json 比 node_modules 新 / package-lock.json 比 node_modules 新（覆盖 git pull 后 lock 漂移）
- 直接 `node --experimental-sqlite server.js &`，**不**走 `npm start`：保证 `$!` 抓到的是 Express 进程本身，trap cleanup 能可靠 kill；npm start 仍保留在 package.json 给手动 dev 用
- PORT 环境变量透传给 server.js

### 6.2 `.gitignore` 追加

```
# Node
node_modules/
npm-debug.log*

# Runtime SQLite (rebuild from data/seed.sql on boot)
data/star.db
data/star.db-journal
data/star.db-wal
data/star.db-shm
```

## 7. 数据维护工作流

### 7.1 改内容流程（维护者）

```
1. 启动 app（startup.sh）—— star.db 已自动从 seed.sql 重建
2. 用 sqlite3 CLI 或 DB Browser 打开 data/star.db
3. INSERT / UPDATE / DELETE
4. 刷新浏览器验证效果（API 已 no-cache，刷新即生效）
5. 满意后 npm run dump  —— 同步回 data/seed.sql
6. git diff data/seed.sql  —— 人眼 review 改动
7. git add data/seed.sql && git commit
```

### 7.2 重建流程（CI / 新 checkout）

```
1. git clone
2. ./startup.sh  —— 第一次启动检测 data/star.db 缺失 → 从 seed.sql 重建 → 启动 Express
```

## 8. 错误处理 & 边界（与 requirements §边界一致，列出实现位置）

| 场景 | 实现位置 | 行为 |
|------|---------|------|
| star.db 缺失 | `db.ensureDb` | 从 seed 重建 + 控制台打印 |
| seed.sql 也缺失 | `db.ensureDb` | 抛错 → startup.sh 进程退出非零 |
| Node < 22 | `startup.sh` | 拒绝启动 |
| API 数据库错误 | `server.js` `/api/manifest` catch | HTTP 500 + `{error}` |
| XHR 网络错 | `MyStar.loadManifest` `onerror` | callback(err) |
| XHR 超时 10s | `MyStar.loadManifest` `ontimeout` | callback(new Error('timeout')) |
| 前端拿到 manifest 但 books=[] | render 函数现有逻辑 | 空首页，不崩 |
| 维护者忘 npm run dump | 不检测 | 下次 fresh checkout 会丢改动 — README 提醒 |
| duplicate slug | SQLite UNIQUE constraint | INSERT 失败，维护者立刻看到 |
| enabled=0 unit | `db.listUnitsEnabled` WHERE 过滤 | 前端不可见 |

## 9. 测试策略（手测，本期不上 unit test 框架）

**Smoke list（每次本期改动后必跑）：**

- [ ] 关 Node、删 `data/star.db` → `./startup.sh` → 控制台见 `built data/star.db from seed`
- [ ] `curl -s http://localhost:8000/api/manifest | jq .` 输出和现有 `manifest.js` 的 `window.MYSTAR_MANIFEST` **结构与值一一对应**（写一个简单 diff 脚本对比即可）
- [ ] 浏览器开首页：guide row / 推荐卡 / 单元列表三件套渲染同迁移前
- [ ] 浏览器开 `review/`：星标卡片照旧聚合
- [ ] 浏览器开 `units/book1/u3/`：单元页样式不变（unit-enhance.js / style/unit-enhance.css 没改）
- [ ] **断网测试**：开 DevTools Network → 选 Offline → 刷新首页 → 应显示加载失败 UI + 重试按钮
- [ ] **重试**：服务恢复后点重试 → 正常加载
- [ ] **超时测试**：node 里改 `app.get('/api/manifest', ...)` 加 `await sleep(12_000)` → 前端应 10s 后报 timeout 失败 UI（测完恢复代码）
- [ ] **iPad 实测**：iPad Safari 打开 http://<host-ip>:8000 → 首页 / unit / review 全部 OK；触摸交互不变
- [ ] **localStorage 不变**：迁移前后手动验证 quiz 分数、starred、streak 一个不变（用同一台 iPad 同浏览器）
- [ ] **server 不碰 user state**：`grep -rE "starredCards|lastVisit|quizScore|mystar_active_days" server* scripts/` 必须 0 结果
- [ ] **dump 输出稳定**：跑 `npm run dump` 两次（中间没改 db），`git diff data/seed.sql` 必须无变化
- [ ] **enabled = 0 实测**：在 db 里把 u3 设 enabled=0，刷新首页应只剩 u6

## 10. 上线 / 切换计划

**预备：**
- 当前 working tree clean（最近一次 commit `a86ec54` 在 origin/main）
- 这次改动会涉及 ~10 个文件 + 一个新目录 + 删 manifest.js
- 切换前手动备份 `iPad → 现有的 localStorage 数据`（用 DevTools 看一眼）—— 防迁移期清浏览器数据

**实施顺序（spec-tasks 阶段拆细）：**

1. 加 `.gitignore` 条目、`package.json`、`server.js`、`server/db.js`、`data/seed.sql`、`scripts/dump.js`
2. 改 `startup.sh`
3. 跑一次 `./startup.sh`，验证 `data/star.db` 生成 + `/api/manifest` 输出正确
4. 加 `MyStar.loadManifest` 到 `js/shared.js`
5. 加 `.load-fail` CSS 到 `style/shared.css`
6. 改 `index.html` 入口（删 `<script src="js/manifest.js">` + boot 异步化）
7. 改 `review/index.html` 入口（同上）
8. **本机浏览器验收**：跑 §9 smoke list 全部 ✓
9. 删 `js/manifest.js`
10. 再跑一次完整 smoke list 防回归
11. **iPad LAN 实测**
12. **fresh checkout 验收**：`git clone --branch <topic> ...` 到一个新临时目录 → `./startup.sh` → 验证一次启动就 OK
13. **更新 steering / 项目文档**：
    - `AGENTS.md` "What this is" 段当前写「no build step, no bundler, no framework, **no package.json**」—— 这次破除了 package.json 那句，更新为「Node 22+ Express 进程 + 浏览器端纯 ES5 静态资源，no bundler、no framework、no transpiler；新增 npm 依赖仅 express」
    - `AGENTS.md` 加一节「运行 / 数据维护」简述 startup.sh / npm run dump
    - `spec-workflow/steering/structure.md` 追加 `server/`、`data/`、`scripts/` 三个新目录的说明
    - `spec-workflow/steering/tech.md` 在「Stack」/「Architectural decisions」更新：从「Python http.server」改为「Express + node:sqlite」、并在「Storage」段强调"用户运行时状态依然 100% localStorage，server 不碰"
    - `README.md` 加一段「启动方式」（npm install / startup.sh 体验仍然双击）
14. **本地 commit**（执行者跑 `git add` 指定文件 + `git commit`，**不要 `git add .`** 避免误带 `data/star.db`）。完成后展示 `git log -1 --stat` 给用户。
15. **`git push` —— 必须等用户明确批准**：commit 完展示 diff 给用户人工 review，得到 "push" 指令后再推；executor 自身不擅自 push。

**回滚预案**：如果 iPad 实测出问题（比如老 Safari 的 XHR / JSON.parse 异常、超时），`git revert` 一个 commit 即回到 a86ec54 的纯静态版。

## 11. 风险与备选

| 风险 | 触发 | 备选 |
|------|------|------|
| `--experimental-sqlite` flag 在某次 Node 更新里 deprecated → 启动崩 | 维护者升级 Node 26+ | 切到 `better-sqlite3`（sync API、最像 node:sqlite 的迁移路径） |
| 老 iPad Safari 不支持 `xhr.timeout` (Safari < 8 才不支持，本场景应该 OK) | 极端老设备 | fallback：`setTimeout(function(){xhr.abort()}, 10000)` |
| 维护者频繁忘记 npm run dump 导致 seed.sql 落后 | 人为 | 在 README + AGENTS.md 加显式提示；后期可加 `pre-commit` hook 阻止 `data/star.db` 比 `data/seed.sql` 新 |
| LAN IP 漂移导致 iPad 书签失效 | 路由器分配 IP | 给电脑设 DHCP 保留地址；mDNS 名字也可（`star.local`）非必须 |
| Express 4.x 升 5.x breaking | 维护者 `npm update` | package.json 用精确版本 / caret 都行；本期不锁死 |

## 12. 不在范围内（复述 requirements）

无新增。所有 out-of-scope 项见 requirements §不在范围内 一节。
