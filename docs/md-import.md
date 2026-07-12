# Markdown 导入工具 (md-to-nine-rings.py)

将 Markdown 文件批量导入为九环笔记。支持两种模式：生成 JSON 文件手动导入，或 `--serve` 直接推送到运行中的开发服务器。

---

## 一、两种导入模式

### 模式 A：生成 JSON → 手动导入（离线、通用）

适用场景：生产构建 (`serve.py`)、Vercel 部署、或无法访问 dev server 时。

```bash
# 导入单个文件
python3 scripts/md-to-nine-rings.py ./docs/github-sync.md

# 导入整个目录（递归扫描所有 .md）
python3 scripts/md-to-nine-rings.py ./my-docs/

# 导入到文档视图的指定路径
python3 scripts/md-to-nine-rings.py --path areas/nine-rings ./docs/github-sync.md
```

**输出**：在当前目录生成 `import-YYYY-MM-DD.json`

**导入步骤**：
1. 打开九环 → 点击右上角 ⚙ 设置
2. 找到 **数据导出 / 导入** 区块
3. 点击 **导入数据**
4. 选择生成的 `import-*.json` 文件
5. 九环自动导入并刷新

### 模式 B：`--serve` 直推（仅 dev server）

适用场景：本地开发调试，`npm run dev` 运行中。

```bash
# 终端 1：启动 Vite dev server（默认端口 1420）
npm run dev

# 终端 2：推送文件
python3 scripts/md-to-nine-rings.py --serve --path areas/nine-rings ./docs/github-sync.md
```

**注意**：`--serve` 连接 `http://localhost:1420/__import`，这是一个仅存在于 Vite dev server 的 API 端点。生产构建的 `serve.py` 不提供此端点。

如果 dev server 用了自定义端口：

```bash
python3 scripts/md-to-nine-rings.py --serve --port 5173 --path areas/nine-rings ./docs/github-sync.md
```

---

## 二、启动本地服务

### 开发模式（含热更新 + `--serve` 支持）

```bash
cd ~/src/nine-rings
npm run dev
# Vite dev server → http://localhost:1420
```

### 生产预览模式（仅静态文件）

```bash
cd ~/src/nine-rings
npm run build
python3 serve.py --port 8000 &
# 静态文件服务 → http://localhost:8000
```

| | `npm run dev` | `serve.py` |
|------|:--:|:--:|
| 热更新 | ✅ | ❌ |
| `--serve` 导入 | ✅ | ❌ |
| 模拟生产环境 | ❌ | ✅ |
| 对外分享（Cloudflare Tunnel） | ❌ | ✅ |

---

## 三、文档导入选项

导入到 **📂 文档视图** 时，可指定 P.A.R.A. 分类和 Diátaxis 类型。

### `--path`：存放路径

对应文档树的 P.A.R.A. 目录。不指定时从来源目录名自动推断（`references/<目录名>`）。

```bash
# 手动指定路径
--path projects/nine-rings
--path areas/performance
--path references/dpdk
--path archives/2025
```

路径中的每一级 `/` 对应文档树的一个文件夹层级。

### `--type`：Diátaxis 文档类型

```bash
--type explanation   # 📖 解释
--type how-to        # 🔧 指南
--type reference     # 📋 参考
--type tutorial      # 🎓 教程
```

### `--concepts`：概念标签

逗号分隔，用于 Zettelkasten 概念关联。

```bash
--concepts DPDK,P4,tunnel
--concepts "性能优化,内存管理"
```

---

## 四、完整示例

### 导入项目文档

```bash
# 将 BLESS 项目文档导入到 projects/bless
python3 scripts/md-to-nine-rings.py \
    --path projects/bless \
    --type reference \
    --concepts DPDK,流量生成,网络测试 \
    ./bless-docs/
```

### 导入个人知识库

```bash
# 将 Obsidian 导出的 .md 文件导入到 references/notes
python3 scripts/md-to-nine-rings.py \
    --path references/notes \
    ./obsidian-export/
```

### 批量导入 + 生产预览

```bash
# 1. 生成导入文件
python3 scripts/md-to-nine-rings.py --path areas/nine-rings ./docs/github-sync.md

# 2. 构建 + 启动服务
npm run build
python3 serve.py --port 8000 &

# 3. 浏览器打开 http://localhost:8000 → 设置 → 导入数据 → 选择 import-*.json
```

---

## 五、支持的 Markdown 语法

| Markdown | 渲染效果 |
|----------|---------|
| `# 标题` / `## 二级` / `### 三级` | H1 / H2 / H3 |
| `**粗体**` | **粗体** |
| `*斜体*` | *斜体* |
| `` `行内代码` `` | `行内代码` |
| ` ```代码块``` ` | 代码块 |
| `- 无序列表` | 无序列表 |
| `1. 有序列表` | 有序列表 |
| `> 引用` | 引用块 |
| `[链接](url)` | 超链接 |
| `---` | 分割线 |

**不支持**：表格、图片、HTML、任务列表 (`- [ ]`)。这些需在导入后手动编辑。

---

## 六、故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `❌ 推送失败：Connection refused` | dev server 未运行或端口不对 | 先执行 `npm run dev`，或使用 `--port` 指定正确端口 |
| `❌ 未找到 .md 文件` | 路径错误或目录内无 .md 文件 | 检查路径拼写，确认文件存在 |
| 导入后内容为空 | .md 文件仅包含暂时不支持的语法（表格等） | 手动编辑补充 |
| 中文文件名乱码 | 终端编码问题 | 确认 `LANG=zh_CN.UTF-8` |
