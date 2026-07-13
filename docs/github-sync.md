# GitHub 同步

九环通过 GitHub 仓库实现多设备数据同步。采用**全量 JSON 快照**方案，支持 Push（上传）/ Pull（下载）。

---

## 快速开始（3 步）

```
1. 生成 Token  →  GitHub Settings → Developer settings → Tokens (classic)
                 勾选 [x] repo，复制 ghp_xxx...

2. 创建仓库    →  New repository，设为 Private，不勾选 README

3. 配置九环    →  ⚙ 设置 → GitHub 同步 → 填入 Token / Owner / Repo → 测试连接
```

---

## 一、生成 GitHub Token

1. 登录 [GitHub](https://github.com)，点击右上角头像 → **Settings**
2. 左侧菜单 → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. 点击 **Generate new token (classic)**
4. 填写：
   - **Note**：`Nine Rings Sync`
   - **Expiration**：建议 `No expiration` 或自定义
   - **Scopes**：勾选 `repo`（核心权限：Contents 读写）

   ```
   [x] repo
       [x] repo:status
       [x] repo_deployment
       [x] public_repo
       [x] repo:invoke
   ```

5. 点击 **Generate token**，**立即复制**（`ghp_xxxx...`）。离开后不可再次查看。

---

## 二、配置字段

| 字段 | 说明 | 示例 |
|------|------|------|
| **Token** | Personal Access Token | `ghp_xxxxxxxxxxxx` |
| **Owner** | GitHub 用户名或组织名 | `erocpil` |
| **Repo** | 仓库名 | `nine-rings-backup` |
| **备份文件路径** | 仓库中 JSON 文件路径 | `nine-rings-backup.json` |

---

## 三、同步操作

### Push（上传）

点击 **Push ↑** 将本地数据上传到 GitHub。

**流程**：
1. 导出本地全部笔记、待办、标签为 JSON
2. 调用 GitHub Contents API（小文件）或 Blobs API（>1MB 大文件）上传
3. 更新远端 SHA 用于下次同步

**使用场景**：
- 完成重要编辑后手动备份
- 换设备前上传最新数据
- 每日定时备份（配合定时任务）

### Pull（下载）

点击 **Pull ↓** 从 GitHub 下载数据覆盖本地。

**流程**：
1. 从 GitHub 拉取 `nine-rings-backup.json`
2. 调用 `importData` 导入
3. **去重检查**：导入前匹配现有笔记

**使用场景**：
- 新设备首次使用九环时拉取数据
- 另一设备 push 后同步到当前设备

### 同步期间界面冻结

Push/Pull 执行期间：
- 编辑器顶部显示**金色横幅**提醒
- 所有笔记设为**只读**，禁止编辑
- 侧栏、文档树、待办、属性面板**禁用**
- 操作完成后横幅自动消失，恢复可编辑状态

**原因**：同步是全量覆盖，期间本地修改会被覆盖。冻结防止数据丢失。

---

## 四、多设备工作流

```
设备 A                  GitHub                  设备 B
───────                ──────                  ───────
编辑笔记
  │
  └── Push ↑ ──────→  nine-rings-backup.json
                                                │
                                      Pull ↓ ───┘
                                                编辑笔记
                                                  │
                                      Push ↑ ────┘
                        nine-rings-backup.json
  │
  └── Pull ↓ ───────
```

**黄金规则**：**先 Pull → 编辑 → 再 Push**

- Push 和 Pull 是**全量操作**，后 push 的覆盖先 push 的
- 两台设备同时编辑 → 只 push 不 pull → 一方数据丢失
- 安全流程：每次编辑前先 Pull，编辑完尽快 Push

---

## 五、示例

### 示例 1：首次配置（单设备备份）

```
目标：在家里的电脑上使用九环，数据备份到 GitHub

步骤：
  1. 生成 Token（权限：repo）
  2. 创建 Private 仓库 nine-rings-backup
  3. 九环设置 → GitHub 同步 → 填入：
     Token:  ghp_abc123...
     Owner:  myname
     Repo:   nine-rings-backup
     路径:   nine-rings-backup.json
  4. 点击 "测试连接" → ✅ 绿色提示
  5. 每次编辑完成后点击 Push ↑

效果：
  - 笔记本数据安全存储在 GitHub
  - 即使电脑重装，数据不丢失
```

### 示例 2：两台设备切换

```
目标：公司电脑和家里电脑都用九环，数据保持一致

设备 A（公司电脑）：
  1. 配置 GitHub 同步（同示例 1）
  2. 下班前：Push ↑

设备 B（家里电脑）：
  1. 打开九环 → 设置 → GitHub 同步
  2. 填入相同的 Token / Owner / Repo
  3. 测试连接
  4. Pull ↓（拉取公司电脑的最新数据）
  5. 开始编辑

第二天回到公司：
  1. 设备 A：Pull ↓（获取昨晚家里编辑的内容）
  2. 继续编辑
```

### 示例 3：.md 文件批量导入 + 同步

```
目标：将本地 Markdown 文档导入九环，并同步到另一设备

步骤：
  1. 在设备 A 上：
     cd /root/src/nine-rings
     python3 scripts/md-to-nine-rings.py --serve --path projects/my-docs ./my-markdown/

  2. 浏览器自动接收导入（dev server 模式）
     或生成 JSON 文件后通过设置页导入

  3. 导入完成后 Push ↑

  4. 在设备 B 上：
     Pull ↓ → 笔记自动出现
     再次运行相同导入命令 → 不会重复（upsert 去重）
```

### 示例 4：定时自动备份

```
目标：每天凌晨 3 点自动 Push 到 GitHub

方法 A — 九环定时任务（推荐）：
  九环内置 cronjob 功能，可配置定时 Push

方法 B — 外部脚本 + 浏览器自动化：
  #!/bin/bash
  # 依赖：九环已打开并配置好 GitHub 同步
  # 通过 API 触发 push（如果后续支持）
  curl -X POST http://localhost:1420/api/sync/push
```

---

## 六、去重机制

### 导入时去重（importData + upsertNote）

同步 Pull 和 .md 导入共用同一套去重策略：

| 优先级 | 匹配键 | 适用场景 | 命中后操作 |
|--------|--------|---------|-----------|
| 1 | `storagePath` | 文档笔记（P.A.R.A. 目录） | 更新内容，保留本地 ID |
| 2 | `title` + `date` | 日记随笔（非文档笔记） | 更新内容，保留本地 ID |
| — | 无匹配 | 新笔记 | 创建，新 UUID |

**效果**：
- 同一篇笔记同步多少次，ID 不变 → 滚动位置不丢
- 侧栏不出现同名重复条目
- `linkedDocIds` 等引用不断裂

### 调试：查看同步详情

九环内置调试面板（`[变更]` 日志）：

```
[Sync] Pull（本地）
[Sync] ├─ 大小: 2.5 MB  |  版本: 1  |  导出: 2026-07-08T10:44:46
[Sync] ├─ 笔记: 42 篇
[Sync] │  ├─ 435e582e  "🎨 功能展示"  2026-07-08
[Sync] │  ├─ 7ffc80bf  "DPDK 注压测方案"  2026-07-08
[Sync] │  └─ ...
[Sync] ├─ 每日页面: 15 页
[Sync] │  ├─ 2026-07-08  (3 todos)
[Sync] │  └─ ...
[importData] 去重合并 3 条，总计 42 notes + 15 pages
```

Push 和 Pull 结果都会以**树形图** dump 到调试窗口。

---

## 七、技术细节

### 大文件处理

GitHub Contents API 对超过 1MB 的文件不返回 `content` 字段。九环自动切换为 **Git Blobs API**：

- 文件 ≤ 1MB → `GET /repos/:owner/:repo/contents/:path`（含 base64 content）
- 文件 > 1MB → `GET /repos/:owner/:repo/contents/:path`（取 sha）
                → `GET /repos/:owner/:repo/git/blobs/:sha`（取内容）

对用户透明，无额外配置。

### 同步配置存储

- Token / Owner / Repo / Path 存储在浏览器 `localStorage`（Web）或 Tauri 本地存储
- Key：`nr:github-sync`
- Token 不会上传到任何第三方服务器
- 建议使用 Private 仓库保护数据

### 同步流程（完整时序）

```
用户点击 Push ↑
  │
  ├─ 界面冻结（金色横幅 + 全部只读）
  ├─ exportFullDB() → JSON 字符串
  ├─ 计算文件大小 → 选择 Contents API 或 Blobs API
  ├─ PUT /repos/:owner/:repo/contents/:path
  ├─ 更新 remoteSha
  ├─ 界面解冻
  └─ toast: "✅ Push 成功" / "❌ 失败原因"

用户点击 Pull ↓
  │
  ├─ 确认提示
  ├─ 界面冻结
  ├─ GET repo contents → JSON 字符串
  ├─ dumpBundle("Pull（远端）") → 调试窗口树形图
  ├─ importData() → 去重导入
  │   ├─ 读取现有笔记，构建去重索引
  │   ├─ 逐条匹配（storagePath > title+date）
  │   └─ 合并或新增
  ├─ 界面解冻
  └─ toast: "✅ Pull 成功" / "❌ 失败原因"
```

---

## 八、故障排查

| 现象 | 可能原因 | 解决 |
|------|---------|------|
| 测试连接失败 (401) | Token 错误或过期 | 重新生成 Token，确认复制完整 |
| 测试连接失败 (404) | Owner/Repo 不存在 | 确认仓库已创建，大小写无误 |
| Push 失败 (409) | 远端 sha 不匹配 | 先 Pull 再 Push |
| Pull 后数据没变 | 远端文件为空 | GitHub 网页查看仓库中 JSON 内容 |
| Pull 后出现重复笔记 | 旧版本 sync（已修复） | 升级到最新版，下次 Pull 自动去重 |
| Push 时大文件失败 | 超过 GitHub API 限制 | 自动切换 Blobs API，无需手动处理 |
| Token 泄露 | Token 被截图或分享 | GitHub Settings → Tokens → Revoke，重新生成 |
