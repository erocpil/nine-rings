# GitHub 同步

九环支持通过 GitHub 仓库实现多设备数据同步。采用**全量 JSON 快照**方案：每次同步将本地完整数据导出为 `nine-rings-backup.json`，上传到指定 GitHub 仓库；拉取时从仓库下载并覆盖本地。

---

## 一、生成 GitHub Token

同步需要 GitHub Personal Access Token，用于访问仓库的 Contents API。

### 步骤

1. 登录 [GitHub](https://github.com)，点击右上角头像 → **Settings**

2. 左侧菜单拉到最底部 → **Developer settings** → **Personal access tokens** → **Tokens (classic)**

3. 点击 **Generate new token** → **Generate new token (classic)**

4. 填写：
   - **Note**：`Nine Rings Sync`（任意标识）
   - **Expiration**：建议选 `No expiration` 或自定义期限
   - **Scopes**：勾选 `repo`（全部勾上即可，核心需要的是 Contents 读写权限）

   ```
   [x] repo
       [x] repo:status
       [x] repo_deployment
       [x] public_repo
       [x] repo:invite
       [x] security_events
   ```

5. 点击 **Generate token**，**立即复制**生成的 token（`ghp_xxxx...`）。

   离开页面后 token 不可再次查看，只能重新生成。

---

## 二、创建备份仓库（可选）

建议创建专用私有仓库存储备份数据。

1. GitHub 首页 → **New repository**
2. 设置：
   - **Repository name**：`nine-rings-backup`（或任意名称）
   - **Private**（推荐，备份数据不公开）
   - 不勾选 "Add a README file"（空仓库即可）
3. 点击 **Create repository**

也可使用已有仓库，备份文件路径默认为仓库根目录的 `nine-rings-backup.json`，可自定义。

---

## 三、在九环中配置

1. 打开九环 → 点击右上角 ⚙ 设置

2. 向下滚动到 **GitHub 同步** 区块

3. 填写以下字段：

   | 字段 | 说明 | 示例 |
   |------|------|------|
   | **Token** | 第一步生成的 Personal Access Token | `ghp_xxxxxxxxxxxx` |
   | **Owner** | GitHub 用户名或组织名 | `erocpil` |
   | **Repo** | 仓库名 | `nine-rings-backup` |
   | **备份文件路径** | 仓库中 JSON 文件的路径 | `nine-rings-backup.json`（默认） |

4. 点击 **测试连接**，验证配置是否正确。

   - ✅ 绿色提示 = 连接正常
   - ❌ 红色提示 = token 或仓库信息有误，检查重试

---

## 四、同步操作

### Push（上传）

点击 **Push ↑** 将本地数据上传到 GitHub。

**使用场景**：
- 完成重要编辑后手动备份
- 换设备前上传最新数据

**原理**：
1. 导出本地全部笔记、待办、标签为 JSON
2. 调用 GitHub Contents API 上传到仓库

### Pull（下载）

点击 **Pull ↓** 从 GitHub 下载数据覆盖本地。

**使用场景**：
- 在新设备上首次使用九环时拉取数据
- 另一设备 push 后，在此设备同步最新内容

**注意**：Pull 会覆盖本地全部数据，操作前有确认提示。

---

## 五、多设备工作流

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

**重要规则**：
- Push 和 Pull 是**全量操作**，不是增量合并
- **后 push 的覆盖先 push 的**——如果两个设备都改了数据，只 push 不 pull 会导致数据丢失
- 安全流程：**先 pull → 编辑 → 再 push**

---

## 六、权限说明

- Token 存储在浏览器 `localStorage` 中，仅用于调用 GitHub Contents API
- 不上传任何数据到九环服务器（九环没有后端服务器）
- 建议仓库设为 **Private**，防止备份数据被公开访问

---

## 七、故障排查

| 现象 | 可能原因 | 解决 |
|------|---------|------|
| 测试连接失败 (401) | Token 错误或过期 | 重新生成 Token，确认已复制完整（包括 `ghp_` 前缀） |
| 测试连接失败 (404) | Owner/Repo 不存在 | 确认仓库已创建，Owner 和 Repo 拼写无误 |
| Push 失败 (409) | 远端文件被他人修改，sha 不匹配 | 先 Pull 获取最新 sha，再 Push |
| Pull 后数据没变 | 远端文件为空或格式错误 | 登录 GitHub 网页查看仓库中 `nine-rings-backup.json` 内容 |
| Token 泄露 | Token 被截图或分享 | 立即在 GitHub Settings → Tokens 中 Revoke，重新生成 |
