#!/usr/bin/env python3
"""
Tauri IPC 静态契约检查

检查 tauri.ts 中所有 invoke() 调用是否在 lib.rs 中注册，
以及 lib.rs 注册的命令是否有对应的 Rust 函数定义。

用法：
  python3 scripts/check-ipc-contract.py

退出码 0 = 通过, 1 = 发现未注册命令, 2 = 脚本错误
"""

import os
import re
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TAURI_TS = os.path.join(PROJECT_ROOT, "src", "lib", "storage", "tauri.ts")
TAURI_DRIVER_TS = os.path.join(PROJECT_ROOT, "src", "lib", "storage", "tauri-driver.ts")
LIB_RS = os.path.join(PROJECT_ROOT, "src-tauri", "src", "lib.rs")
COMMANDS_DIR = os.path.join(PROJECT_ROOT, "src-tauri", "src", "commands")

# ── 1. 提取 tauri.ts 中所有 invoke(command, ...) 调用 ──

def extract_invoke_commands(filepath: str) -> list[tuple[str, int, str]]:
    """返回 [(command_name, line_number, raw_line), ...]"""
    commands = []
    with open(filepath) as f:
        for i, line in enumerate(f, 1):
            # match invoke<...>("command_name", ...) or invoke("command_name", ...)
            m = re.search(r'invoke(?:<[^>]*>)?\("([^"]+)"', line)
            if m:
                cmd = m.group(1)
                commands.append((cmd, i, line.strip()))
    return commands

# ── 2. 提取 lib.rs generate_handler! 中注册的命令 ──

def extract_registered_commands(filepath: str) -> set[str]:
    """从 lib.rs 提取所有注册的 Tauri command 名称"""
    registered = set()
    with open(filepath) as f:
        content = f.read()

    # 匹配 commands::module::function 模式
    # 例如: commands::note::get_note
    for m in re.finditer(r'commands::(\w+)::(\w+)', content):
        module, func = m.group(1), m.group(2)
        # command 名称就是函数名（Tauri 默认用 snake_case 函数名作为 IPC 名称）
        registered.add(func)

    # 也匹配 commands::module::function(app.clone(), ...) 这种
    for m in re.finditer(r'commands::(\w+)::(\w+)\(', content):
        registered.add(m.group(2))

    return registered

# ── 3. 检查 Rust command 函数是否存在 ──

def check_rust_command_exists(command_name: str) -> bool:
    """检查是否有对应的 Rust #[tauri::command] 函数定义"""
    # 搜索所有 commands/ 下的 .rs 文件
    for root, _dirs, files in os.walk(COMMANDS_DIR):
        for fname in files:
            if not fname.endswith(".rs"):
                continue
            fpath = os.path.join(root, fname)
            with open(fpath) as f:
                content = f.read()
            # 匹配 #[tauri::command] 或 #[command] 后跟 pub fn command_name
            pattern = rf'#\[(?:tauri::)?command\]\s*\n\s*pub\s+fn\s+{re.escape(command_name)}\b'
            if re.search(pattern, content, re.MULTILINE):
                return True
    return False

# ── 4. 主逻辑 ──

def main():
    errors = 0
    warnings = 0

    print("=" * 60)
    print("Tauri IPC 静态契约检查")
    print("=" * 60)

    # 4.1 提取前端 invoke 调用
    tauri_invokes = extract_invoke_commands(TAURI_TS)
    driver_invokes = extract_invoke_commands(TAURI_DRIVER_TS)

    # 4.2 提取后端注册列表
    registered = extract_registered_commands(LIB_RS)

    # 4.3 检查每个 invoke 命令是否注册
    all_invokes = tauri_invokes + driver_invokes
    unregistered: list[tuple[str, int, str, str]] = []  # (cmd, line, file, line_content)

    for cmd, line, raw in tauri_invokes:
        if cmd not in registered:
            unregistered.append((cmd, line, "tauri.ts", raw))

    for cmd, line, raw in driver_invokes:
        if cmd not in registered:
            unregistered.append((cmd, line, "tauri-driver.ts", raw))

    print(f"\n前端 invoke 调用: {len(tauri_invokes)} (tauri.ts) + {len(driver_invokes)} (tauri-driver.ts)")
    print(f"lib.rs 注册命令:  {len(registered)}")

    # 4.4 检查注册命令是否有 Rust 实现
    missing_impl = []
    for cmd in sorted(registered):
        if not check_rust_command_exists(cmd):
            missing_impl.append(cmd)

    # ── 输出结果 ──

    if unregistered:
        print(f"\n❌ 未注册的 IPC 命令 ({len(unregistered)}):")
        for cmd, line, fname, raw in unregistered:
            print(f"  {fname}:{line}  invoke(\"{cmd}\", ...)")
        errors += len(unregistered)
    else:
        print("\n✅ 所有 invoke 命令均已注册")

    if missing_impl:
        print(f"\n⚠️  注册但未找到 Rust 实现的命令 ({len(missing_impl)}):")
        for cmd in missing_impl:
            print(f"  {cmd}")
        warnings += len(missing_impl)
    else:
        print("✅ 所有注册命令均有 Rust 实现")

    # 4.5 检查 adapter 方法在两种实现间的覆盖
    print(f"\n--- 适配器方法覆盖 ---")
    print("（TODO: 解析 StorageAdapter 接口并对比 IDB/Tauri 实现）")

    # ── 总结 ──
    print(f"\n{'=' * 60}")
    if errors > 0:
        print(f"结果: ❌ 发现 {errors} 个未注册命令, {warnings} 个警告")
        print("这些命令在 Tauri 桌面端调用时会静默失败。")
        print("请注册缺失命令或迁移到通用 Op 路径。")
        sys.exit(1)
    elif warnings > 0:
        print(f"结果: ⚠️  0 个未注册命令, {warnings} 个警告")
        sys.exit(0)
    else:
        print("结果: ✅ 全部通过")
        sys.exit(0)


if __name__ == "__main__":
    main()
