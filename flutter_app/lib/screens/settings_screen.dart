/// settings_screen.dart — 设置页面
///
/// 包含 GitHub 同步配置（Token、Owner/Repo、Path）和 Push/Pull 操作。
/// 与 Web 端 SettingsSync.tsx 对齐。

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../services/github_sync.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late SyncConfig _cfg;
  SyncStatus? _status;
  bool _busy = false;
  String? _message;
  bool _messageIsError = false;
  bool _editOwnerRepo = false;
  final _ownerRepoCtrl = TextEditingController();
  String? _ownerRepoError;

  @override
  void initState() {
    super.initState();
    _cfg = loadSyncConfig();
    _autoCheck();
  }

  @override
  void dispose() {
    _ownerRepoCtrl.dispose();
    super.dispose();
  }

  void _autoCheck() async {
    if (!_cfg.isConfigured) {
      setState(() => _status = null);
      return;
    }
    final s = await checkStatus(_cfg);
    if (mounted) setState(() => _status = s);
  }

  void _update(SyncConfig Function(SyncConfig) fn) {
    setState(() {
      _cfg = fn(_cfg);
      saveSyncConfig(_cfg);
    });
    _autoCheck();
  }

  void _showMessage(String msg, {bool error = false}) {
    setState(() {
      _message = msg;
      _messageIsError = error;
    });
  }

  void _clearMessage() {
    setState(() {
      _message = null;
      _messageIsError = false;
    });
  }

  // ── Owner/Repo 合并编辑 ──

  static final _ownerRepoRe =
      RegExp(r'^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?/[a-zA-Z0-9._-]+$');

  void _startEditOwnerRepo() {
    _ownerRepoCtrl.text =
        (_cfg.owner.isNotEmpty && _cfg.repo.isNotEmpty)
            ? '${_cfg.owner}/${_cfg.repo}'
            : (_cfg.owner.isNotEmpty ? _cfg.owner : _cfg.repo);
    setState(() {
      _editOwnerRepo = true;
      _ownerRepoError = null;
    });
  }

  void _commitOwnerRepo() {
    final trimmed = _ownerRepoCtrl.text.trim();
    if (!_ownerRepoRe.hasMatch(trimmed)) {
      setState(
          () => _ownerRepoError = '格式: owner/repo（owner 字母数字 -，repo 字母数字 ._-）');
      return;
    }
    final parts = trimmed.split('/');
    _update((c) => SyncConfig(
          token: c.token,
          owner: parts[0],
          repo: parts[1],
          path: c.path,
          lastSyncAt: c.lastSyncAt,
          lastPushVersion: c.lastPushVersion,
          lastPullVersion: c.lastPullVersion,
        ));
    setState(() {
      _editOwnerRepo = false;
      _ownerRepoError = null;
    });
  }

  void _cancelEditOwnerRepo() {
    setState(() {
      _editOwnerRepo = false;
      _ownerRepoError = null;
    });
  }

  // ── 同步操作 ──

  Future<void> _handleCheck() async {
    _clearMessage();
    setState(() => _busy = true);
    try {
      final s = await checkStatus(_cfg);
      if (mounted) {
        setState(() => _status = s);
        _showMessage(s.message, error: !s.ok);
      }
    } catch (e) {
      _showMessage('错误: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _handlePush() async {
    _clearMessage();
    setState(() => _busy = true);
    try {
      final provider = context.read<NoteProvider>();
      final updated = await pushToGitHub(
        _cfg,
        exportData: () => provider.exportAll(),
      );
      if (mounted) {
        setState(() => _cfg = updated);
        _showMessage('推送成功');
      }
    } catch (e) {
      _showMessage('推送失败: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _handlePull() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('确认拉取'),
        content: const Text('从 GitHub 拉取将覆盖本地数据，确认？'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('取消')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('确认拉取', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    _clearMessage();
    setState(() => _busy = true);
    try {
      final provider = context.read<NoteProvider>();
      final updated = await pullFromGitHub(
        _cfg,
        importData: (json) async {
          final result = await provider.importBundle(json);
          return (
            notesImported: result.notesImported,
            pagesImported: result.pagesImported,
          );
        },
      );
      if (mounted) {
        setState(() => _cfg = updated);
        _showMessage('拉取成功');
        await provider.loadRecentDates();
      }
    } catch (e) {
      _showMessage('拉取失败: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// 格式化版本时间戳 "20260715T123000" → "2026-07-15 20:30:00"
  String _fmtVersion(String? version) {
    if (version == null || version.length != 15) return version ?? '';
    final y = version.substring(0, 4);
    final M = version.substring(4, 6);
    final d = version.substring(6, 8);
    final h = version.substring(9, 11);
    final m = version.substring(11, 13);
    final s = version.substring(13, 15);
    // 版本时间戳为 UTC，显示时不做本地转换（与 Web 端一致）
    return '$y-$M-$d $h:$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('设置')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── 同步中横幅 ──
          if (_busy)
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Row(
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 8),
                  Text('同步中…'),
                ],
              ),
            ),

          // ── GitHub 同步 ──
          Text('GitHub 同步',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(
            '全量 JSON 快照同步。需要 GitHub Personal Access Token（repo 权限）。',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),

          // Token
          TextField(
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'Token',
              hintText: 'ghp_...',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            controller: TextEditingController(text: _cfg.token),
            onChanged: (v) =>
                _update((c) => SyncConfig(
                      token: v,
                      owner: c.owner,
                      repo: c.repo,
                      path: c.path,
                      lastSyncAt: c.lastSyncAt,
                      lastPushVersion: c.lastPushVersion,
                      lastPullVersion: c.lastPullVersion,
                    )),
          ),
          const SizedBox(height: 12),

          // Owner / Repo
          if (_editOwnerRepo) ...[
            TextField(
              decoration: InputDecoration(
                labelText: 'Owner / Repo',
                hintText: 'erocpil/nine-rings-backup',
                border: const OutlineInputBorder(),
                isDense: true,
                errorText: _ownerRepoError,
              ),
              controller: _ownerRepoCtrl,
              onChanged: (_) => _ownerRepoError = null,
              onSubmitted: (_) => _commitOwnerRepo(),
              onEditingComplete: _commitOwnerRepo,
              autofocus: true,
            ),
            const SizedBox(height: 4),
            TextButton(onPressed: _cancelEditOwnerRepo, child: const Text('取消')),
          ] else
            GestureDetector(
              onDoubleTap: _startEditOwnerRepo,
              child: AbsorbPointer(
                child: TextField(
                  decoration: InputDecoration(
                    labelText: 'Owner / Repo',
                    hintText: _cfg.isConfigured ? null : '双击设置 owner/repo',
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  controller: TextEditingController(
                      text: _cfg.isConfigured
                          ? '${_cfg.owner}/${_cfg.repo}'
                          : ''),
                  enabled: false,
                ),
              ),
            ),
          const SizedBox(height: 12),

          // Path
          TextField(
            decoration: const InputDecoration(
              labelText: '备份文件路径',
              hintText: 'nine-rings-backup.json',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            controller: TextEditingController(text: _cfg.path),
            onChanged: (v) =>
                _update((c) => SyncConfig(
                      token: c.token,
                      owner: c.owner,
                      repo: c.repo,
                      path: v,
                      lastSyncAt: c.lastSyncAt,
                      lastPushVersion: c.lastPushVersion,
                      lastPullVersion: c.lastPullVersion,
                    )),
          ),
          const SizedBox(height: 12),

          // ── 状态 ──
          if (_status != null)
            Container(
              padding: const EdgeInsets.all(10),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: _status!.ok
                    ? Colors.green.withAlpha(30)
                    : Colors.red.withAlpha(30),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Text(_status!.ok ? '✅' : '❌'),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_status!.message)),
                ],
              ),
            ),

          // ── 版本信息 ──
          if (_cfg.lastPushVersion != null || _cfg.lastPullVersion != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Wrap(
                spacing: 16,
                children: [
                  if (_cfg.lastPushVersion != null)
                    Text('上次 Push: ${_fmtVersion(_cfg.lastPushVersion)}',
                        style: theme.textTheme.bodySmall),
                  if (_cfg.lastPullVersion != null)
                    Text('上次 Pull: ${_fmtVersion(_cfg.lastPullVersion)}',
                        style: theme.textTheme.bodySmall),
                ],
              ),
            ),

          // ── 消息 toast ──
          if (_message != null)
            Container(
              padding: const EdgeInsets.all(10),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: _messageIsError
                    ? Colors.red.withAlpha(30)
                    : Colors.green.withAlpha(30),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '${_messageIsError ? '✗ ' : '✓ '}$_message',
                style: TextStyle(
                  color:
                      _messageIsError ? Colors.red.shade700 : Colors.green.shade700,
                ),
              ),
            ),

          // ── 按钮 ──
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy ? null : _handleCheck,
                  child: const Text('测试连接'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  onPressed: _busy ? null : _handlePush,
                  child: const Text('Push ↑'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.tonal(
                  onPressed: _busy ? null : _handlePull,
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.red.withAlpha(30),
                    foregroundColor: Colors.red.shade700,
                  ),
                  child: const Text('Pull ↓'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
