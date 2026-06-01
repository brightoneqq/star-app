# 色彩规范（海军航海主题）

This is the **single source of truth** for color usage in star-app. All UI work — homepage, unit pages, review page, future features — must reference these tokens or the CSS variables that map to them. Do not introduce ad-hoc hex values in HTML/CSS without listing the reason here first.

## 主题：Naval explorer（海军航海手册）

灵感来源于小学男生喜欢的探险地图风。整体偏沉稳的海军蓝，配青绿（海色）+ 琥珀（罗盘/星点）做强调，绿色用作"掌握/正确"的成就色。**不要粉色**。

## Token 总表

所有 token 都已在 `style/shared.css` 的 `:root` 里声明。下表给出 token、十六进制、用途。

| Token | Hex | 用途 |
|-------|-----|------|
| `--bg-color` | `#E8F0F5` | 页面底色（淡海蓝，像旧地图的水面） |
| `--card-bg` | `#FCFCF7` | 卡片底色（冷调奶白，纸感） |
| `--ink` | `#163A5F` | "墨水"色，描边 / 阴影 / 主标题字色 |
| `--text-primary` | `#163A5F` | 主文字 |
| `--text-secondary` | `#566B7C` | 次文字（板岩蓝灰） |
| `--text-tertiary` | `#8E9DAB` | 三级文字 |
| `--accent-navy` | `#1E5FB8` | 主强调色：CTA、链接、推荐卡描边、"进行中"状态 |
| `--accent-navy-soft` | `#E2EBF8` | 主强调色的浅底（按钮 hover、状态徽章背景、note 框背景） |
| `--accent-teal` | `#2EB5A6` | 海色：今日卡片高亮、check 勾色、辅助 emoji 背景 |
| `--accent-teal-soft` | `#DAF1ED` | teal 浅底 |
| `--accent-amber` | `#F4A52E` | 暖色强调：streak 火焰、星标 ★、note 左边线、重点集按钮 |
| `--accent-amber-soft` | `#FFF4DC` | amber 浅底（streak 卡背景、note 框背景） |
| `--accent-green` | `#2C8F5F` | "掌握"成就色 + quiz 正确反馈 |
| `--accent-green-soft` | `#E0F0E5` | green 浅底（"掌握"徽章背景、正确答案背景） |
| `--neutral-gray` | `#8E9DAB` | "未开始"状态文字 |
| `--neutral-gray-soft` | `#E5EAEF` | "未开始"状态背景 / 分隔线 |
| `--overlay-tint` | `rgba(22, 58, 95, 0.55)` | Modal / dialog 蒙层；由 --ink 加 0.55 alpha 派生 — 遵循规则 #6 软变体可合成 |

## 兼容别名（不要在新代码里直接用，但旧代码可保留）

为了让 review/index.html 和 units/*/index.html 的旧硬编码自动跟随主题，shared.css 里维护了几个 alias：

| 别名 | 实际指向 |
|------|----------|
| `--accent-blue` | `--accent-navy` |
| `--accent-orange` | `--accent-amber` |
| `--accent-pink` | `--accent-navy`（粉色已被废弃） |
| `--accent-yellow` | `--accent-amber` |
| `--border-color` | `--ink` |
| `--shadow-sm` | `3px 3px 0 0 #163A5F` |
| `--shadow-md` | `4px 4px 0 0 #163A5F` |
| `--shadow-lg` | `5px 5px 0 0 #163A5F` |

**新代码请直接用 `--accent-navy / --accent-teal / --accent-amber / --accent-green`，不要用别名**。

## 阴影 = 偏移硬阴影（手账贴纸感）

`--shadow-sm/md/lg` 是带方向偏移的 `Xpx Xpx 0 0 #163A5F`（**没有 blur**），是首页纸质手账感的关键。任何想用"柔影"的地方，必须显式覆盖（例如 unit 页面卡片密集场景）——不要 fork 一个新的全局 token。

## 使用规则

1. **不要在 HTML/CSS 里写新硬编码十六进制色值**（除了状态色"错答红 `#C0392B`"这类不在主题色系内的语义色）。如果觉得必须加，先来这里写一行。
2. **`--accent-amber` 是唯一暖色**——不要再引入橙、黄、桃、珊瑚等。  
3. **"掌握 / 正确"统一用 `--accent-green`**，别用蓝或青替代。  
4. **"未开始"统一灰底灰字**（`--neutral-gray-soft` + `--neutral-gray`），不要用蓝。  
5. **首页 + 重点集**用纸质手账骨架：`border: 2px solid var(--ink)` + `box-shadow: var(--shadow-md)` + 轻微旋转。  
6. **Unit 学习页**因为卡片密集（30+ 张），保留圆角 + 柔阴影感，**只对齐色板**，不强制描边/偏移阴影。  
7. **错答状态色** `#C0392B`（深朱砂）是允许的语义色例外，不进入主题 token。
8. **禁止装饰性 `border-left`**：任何块级元素（例句框、提示框、对比框、引言等）不要再用 `border-left: Npx solid <color>` 当"左侧色条"装饰。区分语义就用背景色 + 圆角即可。功能性 border（如 `.blank` 的 `border-bottom` 下划线、表格 cell 描边）不在此限。
