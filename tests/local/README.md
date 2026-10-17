# 完整备份隔离演练

当前 Web/Tauri 0.3.0 已开放认证协议；本目录原有假设能力模式仍只覆盖隔离模拟。以下分开记录模拟、原生 SQLite 和真实 GitHub 演练，不能互相替代证据。

此目录不在普通 Vitest / CI 用例范围内。演练只读取显式指定的本机备份，使用 Node 进程内的 fake IndexedDB、内存 Git 对象和模拟宿主；禁止 `fetch`，不连接 GitHub、不导入真实数据库、不改写输入。

```sh
NR_SYNC_DRY_RUN_INPUT=/absolute/path/to/backup.json \
  bash scripts/with-local-tools.sh node scripts/rehearse-sync-backup.mjs
bash scripts/with-local-tools.sh npx tsc --project tsconfig.sync-local.json
```

输入上限 64 MiB，需至少两份文档及一个模板；测试在内存副本中改变两个标题与一个模板名。先在已有协议空间发布一个本机选择，保留远端及忽略选择；模拟分支更新成功但响应丢失，核对冻结记录并恢复接受状态。然后模拟另一客户端 Pull，正文应用后丢失确认，再按目标摘要核实恢复，断言不重复应用。

能力声明仅在本测试模块内模拟，生产 `CURRENT_SYNC_CAPABILITIES` 不变。输出仅有阶段、运行时、字节数、数量和耗时，不输出标题、正文、实体 ID 或凭据。大文件可能耗时数分钟；耗时包含重复认证、内存 Git 和 fake IndexedDB，不能当作真实网络或 SQLite 性能。

此演练验证完整数据的组装、64 MiB 目标预算、128 MiB 日志预算、持久记录回读和恢复逻辑；不证明真实进程重启、原生数据库导入、GitHub 网络传输、首次迁移或多设备并发已验收。小样本可用 `schema/sync/fixtures/candidate-entities-v1.json`，不依赖私有备份。

主入口按 Web、Tauri 分别启动进程，任一失败即停止，不继续下一端。`NR_SYNC_DRY_RUN_RUNTIME=web` 或 `tauri` 可只测一端。大数据路径使用普通函数与显式调用计数，避免 spy 的历史记录保留完整备份。

`NR_SYNC_DRY_RUN_HEAP_MB=1024` 可限制每个测试 worker 的 V8 老生代堆（允许 256～4096 MiB，不设置则沿用 Node 默认值）。它只影响测试，不修改系统或应用工具链。结果中的 `peakRssKiB` 为该 worker 最大常驻内存（KiB），包括年轻代、外部缓冲区、测试框架、模拟 Git/IndexedDB 和开发依赖，不能解释为应用峰值或“总内存不超过老生代限额”。实际应用存储和生产界面需单独测量。

直接运行 Vitest 配置仍可做功能检查，但不要把同一 worker 连续两端的内存高水位作为独立客户端测量。fake IndexedDB 会保留已完成事务/请求等测试对象；资源测量使用上述独立进程入口。

`NR_SYNC_DRY_RUN_SCENARIO=all-documents` 会在内存副本中修改全部文档标题和模板名称，发布所有差异，再从原始本机副本 Pull 全部差异并核验丢失确认恢复。它补充默认的本机/远端/忽略混合选择；不是所有正文、设置或保护记录同时改变的绝对最坏情况，也不覆盖首次迁移。

## 真实浏览器测量

```sh
NR_SYNC_DRY_RUN_INPUT=/absolute/path/to/backup.json \
  bash scripts/with-local-tools.sh node scripts/profile-sync-browser.mjs
# 同一命令加 NR_SYNC_PROFILE_BROWSER=webkit 可测 WebKit。
```

该入口单独打包现有认证/投影代码（生产压缩，无 Vitest/fake IndexedDB），启动只监听 127.0.0.1 随机端口的临时服务器和全新浏览器上下文，阻止访问其它 origin。备份通过浏览器自动化传入，不作为 HTTP 文件提供；真实 IndexedDB 仅使用隔离测试库，写入后回读并核对 SHA-256，最后删除测试库并关闭上下文。不会开启同步、修改产品数据库或连接 GitHub；输入仍限制 64 MiB，输出不含正文/标识/凭据。浏览器需已安装。

测量范围仅为候选认证/投影及原始来源字符串的真实 IndexedDB 往返，不是完整发布/Pull，也不是产品存储适配器或原生 SQLite。Chromium 输出各阶段结束时 CDP 的 JS 已用堆（不强制 GC），并非进程 RSS 或峰值；卸载后即时采样也不能证明稳定释放。WebKit 缺少对应接口，内存为 null，不拿 Chromium 堆值推断 Tauri。不得将这段的良好结果替代后续全流程和真实宿主测量。

512 MiB/1 GiB 老生代实验仅为诊断条件，不是产品最低内存或发布硬门禁。依据真实宿主的额外内存、响应性、失败与释放表现确定预算，再决定是否进行较大重构。

`NR_SYNC_PROFILE_SCOPE=planning` 会在内存副本改写全部文档标题与模板名称，执行真实逐实体规划及候选组装，核对选择数、全部出站实体摘要及 writable=false；仍不创建协议空间或发布。该路径覆盖完整候选组装，不包含固定远端审查、发布/Pull 日志及网络。

`NR_SYNC_PROFILE_SCOPE=storage` 改用产品 Web 数据库存储适配器及已有前端设置备份层：导入到临时 origin 的数据库、导出、比较原有实体投影；刷新页面后再次导出核对摘要。只加载这些模块，没有启动产品界面，也不覆盖 API 保存屏障、原生 SQLite 或增量应用事务。文档/设置变化或丢失会输出按类型聚合的诊断并以 2 退出；新增默认实体单独计数，运行错误为 1，原有实体完整保留且重载稳定为 0。整份原始备份与本机日常数据库均不改动。

`NR_SYNC_PROFILE_BROWSER=both` 可一次运行两种浏览器，每端独立进程和上下文，失败即停止；便于合并本机端口/浏览器权限。storage 构建复用产品的 Worker-safe 实体解码依赖配置，服务端只提供编译生成的脚本/Worker资源，不提供备份文件。测量过程中发现差异不代表迁移可用或已经修复产品，仍需分辨适配器、前端设置层与同步事务的职责。

## 旧格式首次切换演练

`NR_SYNC_DRY_RUN_REMOTE=legacy` 从无协议头、无控制文件的旧格式远端起步；保留所有旧快照和无关文件，显式选择后创建首个协议快照（parent=null），模拟发布响应丢失，再验证另一端 Pull 的应用确认丢失恢复。

`NR_SYNC_DRY_RUN_REMOTE=checkpoint` 则让本机与旧远端内容相同，显式启用迁移检查点；只建立协议，不发布本机差异、不创建实体接受回执，也不重放无需执行的正文导入。该模式不能同时传 `NR_SYNC_DRY_RUN_SCENARIO`。默认 remote=enabled，保留已有空间追加演练。

这些模式仍只使用模拟 Git、fake IndexedDB 和测试模块内的假设能力；备份验证及设备确认是测试输入，不代表用户真实文件下载确认或全部设备升级已验收。这组模拟不执行原生/真实双端或产品入口验收；其它类型的验证见下方独立工具。

`NR_SYNC_DRY_RUN_REMOTE=empty` 从只有无关文件的空备份空间开始，调用保存边界后的首次发布准备，核对首快照 parent=null、所有出站实体在远端确认后才接受，以及另一端 Pull 确认丢失恢复。此模式不伪造非空远端审查；与 legacy/checkpoint 一起构成首次切换的服务层矩阵，仍不是实际远端仓库或用户迁移验收。

## 捕获冻结记录并验证真实浏览器日志存储

`NR_SYNC_DRY_RUN_CAPTURE_JOURNALS=1` 可选地把服务层实际生成的 PREPARED 发布记录和 APPLYING Pull 记录写到 `.local-tools/sync-journal-*/`。每条记录独立随机目录（权限 700）和独占文件（600），日志只输出文件位置，不输出正文。目录受 Git 忽略；文件包含私人文档及设置，不能提交、上传或附到公共日志。不开启此选项则不产生这些文件；checkpoint 模式没有 Pull 记录。

```sh
NR_SYNC_DRY_RUN_INPUT=/absolute/backup.json \
  NR_SYNC_DRY_RUN_REMOTE=empty NR_SYNC_DRY_RUN_RUNTIME=web \
  NR_SYNC_DRY_RUN_CAPTURE_JOURNALS=1 \
  bash scripts/with-local-tools.sh node scripts/rehearse-sync-backup.mjs \
  > /tmp/sync-capture.log 2>&1
bash scripts/with-local-tools.sh env \
  NR_SYNC_JOURNAL_CAPTURE_LOG=/tmp/sync-capture.log \
  node scripts/profile-sync-journals.mjs
```

批量入口仅接收捕获日志中列出的 1～4 个 `.local-tools` 内实际文件，逐条在 Chromium/WebKit 的全新上下文执行；失败即停止。scope=journal 输入上限 128 MiB；不连接网络、不调用发布、恢复或接受确认服务。使用产品实际日志存储函数，核对取消回滚、完整记录摘要回读、并发比较更新只有一个成功、摘要状态以及页面重载后的持久性，接受回执始终为零。发布记录在此隔离存储测试中转为 UNKNOWN，Pull 转为 NEEDS_REVIEW；这些是存储测试状态，不是已证明的远端/正文结果。不得把这项测试当作新协议认证、完整恢复服务或真实进程重启的证据。


## 原生 SQLite 完整备份与事务回滚

```sh
NR_SYNC_DRY_RUN_INPUT=/absolute/path/to/backup.json \
  bash scripts/with-local-tools.sh cargo test --manifest-path src-tauri/Cargo.toml \
  --locked --lib private_backup_disk_reopen_and_atomic_rollback -- --ignored --nocapture
```

显式 opt-in，普通 Rust 测试忽略。只读输入（最多 64 MiB），在仓库 `.local-tools` 的随机私有目录创建实际 WAL 数据库，执行生产导入、关闭重开、完整导出与故意失败导入的事务回滚验证；测试后删除自己创建的临时数据库，不启动安装的 Tauri 应用，不使用其数据目录。仅输出数量与耗时。

## 真实 GitHub 与独立浏览器进程

```sh
bash scripts/with-local-tools.sh env NR_SYNC_LIVE_BROWSER=both \
  node scripts/rehearse-sync-live.mjs --check-bundle
bash scripts/with-local-tools.sh env NR_SYNC_LIVE=1 NR_SYNC_LIVE_BROWSER=both \
  node scripts/rehearse-sync-live.mjs
```

第二条是写入操作，只用于已授权的 `erocpil/nine-rings-backup` 测试仓库。工具通过 gh 会话在内存中读取凭据，创建唯一 orphan 测试分支，只上传公开 schema fixture，不读取私有备份，不删除文件或修改默认分支。测试浏览器内把仓库发现返回的 default_branch 指向新分支，以隔离既有长历史；实际 GitHub 默认分支没有更改，因此这不是默认分支选择的线上验收。

分别用 Chromium/WebKit 的两个独立持久配置，调用实际 API/发布/Pull/接受与恢复服务：首次发布前中断取消重试、相同确认、冲突合并保留未选设置、PATCH 响应丢失后关闭进程恢复、真实导入完成但确认丢失后重启恢复、离线零发布和竞争拒绝（不强推），另补旧快照首次迁移与第二客户端 Pull。`--legacy-only` 仅运行后者，也创建独立新分支。当前生产 profile 已启用，工具不替换它；`candidateProfile` 记入报告。运行报告和浏览器配置只保存在 `.local-tools/sync-live-*/`，测试分支保留供检查，未经授权不清理。
