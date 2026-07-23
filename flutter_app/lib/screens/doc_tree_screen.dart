import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../models/note.dart';
import '../constants/doc_constants.dart';
import '../widgets/doc_type_badge.dart';
import 'note_editor_screen.dart';

/// 文档树屏幕 — 完整的 P.A.R.A. 文档树，匹配 Tauri DocTree.tsx 设计
class DocTreeScreen extends StatefulWidget {
  const DocTreeScreen({super.key});

  @override
  State<DocTreeScreen> createState() => _DocTreeScreenState();
}

class _DocTreeScreenState extends State<DocTreeScreen> {
  final Set<String> _collapsed = {};
  String? _selectedId;
  String? _renamingId;
  String? _renamingFolder;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<NoteProvider>().loadPathTree();
    });
  }

  // ── 构建所有文件夹路径集合 ──
  Set<String> _buildAllFolders(Map<String, List<Note>> pathTree) {
    final folders = <String>{};
    // 根目录 P.A.R.A.
    for (final root in ['projects', 'areas', 'references', 'ideas', 'archives']) {
      folders.add(root);
    }
    // 从 pathTree keys 收集
    for (final key in pathTree.keys) {
      final parts = key.split('/');
      for (int i = 0; i < parts.length; i++) {
        folders.add(parts.sublist(0, i + 1).join('/'));
      }
    }
    // 从 notes 的 storagePath 收集
    for (final notes in pathTree.values) {
      for (final note in notes) {
        if (note.storagePath != null) {
          final parts = note.storagePath!.split('/');
          for (int i = 0; i < parts.length; i++) {
            folders.add(parts.sublist(0, i + 1).join('/'));
          }
        }
      }
    }
    return folders;
  }

  // ── 获取子文件夹 ──
  List<String> _getSubFolders(String path, Set<String> allFolders) {
    return allFolders
        .where((f) {
          if (f == path) return false;
          final lastSep = f.lastIndexOf('/');
          final parent = lastSep == -1 ? '' : f.substring(0, lastSep);
          return parent == path;
        })
        .toList()
      ..sort();
  }

  // ── 排序：文件夹在前 → 文档按类型分组 → 再按字母序 ──
  void _sortMixed(List<String> folders, List<Note> docs) {
    docs.sort((a, b) {
      // 1. docType grouping (explanation → how-to → reference → tutorial → others)
      const order = ['explanation', 'how-to', 'reference', 'tutorial'];
      final ai = order.indexOf(a.docType ?? '');
      final bi = order.indexOf(b.docType ?? '');
      final typeCmp = (ai == -1 ? 999 : ai).compareTo(bi == -1 ? 999 : bi);
      if (typeCmp != 0) return typeCmp;

      // 2. Alphabetical by title
      final na = a.title ?? '';
      final nb = b.title ?? '';
      final cmp = na.compareTo(nb);
      if (cmp != 0) return cmp;

      // 3. sortOrder fallback
      return a.sortOrder.compareTo(b.sortOrder);
    });
  }

  // ── 获取文件夹名 ──
  String _folderName(String path) => path.contains('/') ? path.split('/').last : path;
  // ── 获取文件夹图标 ──
  String _folderIcon(String path) => stateIcons[path.split('/').first] ?? '📂';
  // ── 统计目录下文档数 ──
  int _countDocsUnder(String path, Map<String, List<Note>> pathTree) {
    int count = (pathTree[path]?.length ?? 0);
    for (final key in pathTree.keys) {
      if (key != path && key.startsWith('$path/')) {
        count += pathTree[key]?.length ?? 0;
      }
    }
    return count;
  }

  void _collapseAll(Set<String> allFolders) {
    setState(() {
      _collapsed.addAll(allFolders);
    });
  }

  void _collapseOthers(Map<String, List<Note>> pathTree, Set<String> allFolders) {
    if (_selectedId == null) return;
    // 找到选中笔记的路径
    String? selectedPath;
    for (final notes in pathTree.values) {
      for (final note in notes) {
        if (note.id == _selectedId && note.storagePath != null) {
          selectedPath = note.storagePath!;
          break;
        }
      }
      if (selectedPath != null) break;
    }
    if (selectedPath == null) return;

    // 收集所有祖先路径
    final ancestors = <String>{};
    final parts = selectedPath.split('/');
    for (int i = 1; i < parts.length; i++) {
      ancestors.add(parts.sublist(0, i).join('/'));
    }

    setState(() {
      _collapsed.clear();
      for (final f in allFolders) {
        if (!ancestors.contains(f)) {
          _collapsed.add(f);
        }
      }
    });
  }

  Future<void> _onDocTap(Note note) async {
    final fullNote = await context.read<NoteProvider>().loadNote(note.id);
    if (!mounted) return;
    setState(() => _selectedId = note.id);
    if (fullNote != null) {
      await Navigator.push<bool>(
        context,
        MaterialPageRoute(
          builder: (_) => NoteEditorScreen(
            date: fullNote.date,
            note: fullNote,
          ),
        ),
      );
      // 刷新树
      if (mounted) {
        context.read<NoteProvider>().loadPathTree();
      }
    }
  }

  void _showDocContextMenu(BuildContext context, Note note, Offset position) {
    final provider = context.read<NoteProvider>();
    showMenu<String>(
      context: context,
      position: RelativeRect.fromLTRB(position.dx, position.dy, position.dx, position.dy),
      items: [
        const PopupMenuItem(value: 'rename', child: Text('重命名')),
        const PopupMenuItem(value: 'toggle_readonly', child: Text('切换只读')),
        const PopupMenuItem(
          value: 'delete',
          child: Text('删除', style: TextStyle(color: Colors.red)),
        ),
      ],
    ).then((value) async {
      if (!mounted || value == null) return;
      if (value == 'rename') {
        setState(() => _renamingId = note.id);
      } else if (value == 'toggle_readonly') {
        await provider.updateNote(note, readonly: !note.readonly);
        provider.loadPathTree();
      } else if (value == 'delete') {
        final confirm = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('删除文档'),
            content: Text('确定删除「${note.title ?? '无标题'}」？\n删除后可从回收站恢复。'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('删除', style: TextStyle(color: Colors.red)),
              ),
            ],
          ),
        );
        if (confirm == true) {
          await provider.deleteNote(note.id, note.date);
          provider.loadPathTree();
        }
      }
    });
  }

  void _showFolderContextMenu(BuildContext context, String folderPath, Offset position) {
    showMenu<String>(
      context: context,
      position: RelativeRect.fromLTRB(position.dx, position.dy, position.dx, position.dy),
      items: [
        const PopupMenuItem(value: 'rename_folder', child: Text('重命名')),
        const PopupMenuItem(
          value: 'delete_folder',
          child: Text('删除目录及其下文档', style: TextStyle(color: Colors.red)),
        ),
        const PopupMenuItem(value: 'toggle_readonly_folder', child: Text('切换目录下文档只读')),
      ],
    ).then((value) async {
      if (!mounted || value == null) return;
      final provider = context.read<NoteProvider>();
      if (value == 'rename_folder') {
        setState(() => _renamingFolder = folderPath);
      } else if (value == 'delete_folder') {
        // 收集该目录下所有文档 ID
        final ids = <String>[];
        for (final notes in provider.pathTree.values) {
          for (final note in notes) {
            if (note.storagePath != null && note.storagePath!.startsWith('$folderPath/')) {
              ids.add(note.id);
            }
          }
        }
        // Also direct children
        ids.addAll((provider.pathTree[folderPath] ?? []).map((n) => n.id));

        if (ids.isEmpty) return;
        final confirm = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('删除目录'),
            content: Text('确定删除「${_folderName(folderPath)}」及其下 ${ids.length} 篇文档？\n删除后可从回收站恢复。'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('删除', style: TextStyle(color: Colors.red)),
              ),
            ],
          ),
        );
        if (confirm == true) {
          for (final id in ids) {
            try {
              await provider.loadNote(id).then((n) {
                if (n != null) provider.deleteNote(id, n.date);
              });
            } catch (_) {}
          }
          provider.loadPathTree();
        }
      } else if (value == 'toggle_readonly_folder') {
        // 收集目录下文档并切换只读
        final ids = <String>[];
        int readonlyCount = 0;
        for (final notes in provider.pathTree.values) {
          for (final note in notes) {
            if (note.storagePath != null && note.storagePath!.startsWith('$folderPath/')) {
              ids.add(note.id);
              if (note.readonly) readonlyCount++;
            }
          }
        }
        for (final note in (provider.pathTree[folderPath] ?? [])) {
          ids.add(note.id);
          if (note.readonly) readonlyCount++;
        }
        if (ids.isEmpty) return;
        final setTo = readonlyCount < ids.length / 2;
        for (final id in ids) {
          final note = await provider.loadNote(id);
          if (note != null) {
            await provider.updateNote(note, readonly: setTo);
          }
        }
        provider.loadPathTree();
      }
    });
  }

  // ── 递归构建树节点 ──
  List<Widget> _buildTree(
    String path,
    int depth,
    Map<String, List<Note>> pathTree,
    Set<String> allFolders,
    ThemeData theme,
  ) {
    final widgets = <Widget>[];
    final isCollapsed = _collapsed.contains(path);
    final notes = List<Note>.from(pathTree[path] ?? []);
    final subFolders = _getSubFolders(path, allFolders);
    _sortMixed(subFolders, notes);

    // Sub-folders
    for (final subPath in subFolders) {
      final hasChildren = _getSubFolders(subPath, allFolders).isNotEmpty ||
          (pathTree[subPath]?.isNotEmpty ?? false);
      final docCount = _countDocsUnder(subPath, pathTree);

      widgets.add(
        GestureDetector(
          onLongPressStart: (details) {
            _showFolderContextMenu(context, subPath, details.globalPosition);
          },
          child: _renamingFolder == subPath
              ? _FolderRenameTile(
                  initialName: _folderName(subPath),
                  depth: depth,
                  folderPath: subPath,
                  folderIcon: _folderIcon(subPath),
                  onSubmit: (newName) => _submitFolderRename(subPath, newName),
                  onCancel: () => setState(() => _renamingFolder = null),
                )
              : ExpansionTile(
                  tilePadding: EdgeInsets.only(left: 6.0 + depth * 8.0),
                  initiallyExpanded: !isCollapsed,
                  leading: Text(
                    hasChildren ? (isCollapsed ? '▶' : '▼') : '  ',
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                  title: Row(
                    children: [
                      Text(_folderIcon(subPath), style: const TextStyle(fontSize: 14)),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          _folderName(subPath),
                          style: TextStyle(
                            fontSize: 13,
                            color: theme.colorScheme.onSurface,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (docCount > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primary.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            '$docCount',
                            style: TextStyle(
                              fontSize: 11,
                              color: theme.colorScheme.primary,
                            ),
                          ),
                        ),
                    ],
                  ),
                  onExpansionChanged: (expanded) {
                    setState(() {
                      if (expanded) {
                        _collapsed.remove(subPath);
                      } else {
                        _collapsed.add(subPath);
                      }
                    });
                  },
                  children: _buildTree(subPath, depth + 1, pathTree, allFolders, theme),
                ),
        ),
      );
    }

    // Documents
    for (final note in notes) {
      final isSelected = note.id == _selectedId;
      final isRenaming = note.id == _renamingId;

      widgets.add(
        GestureDetector(
          onLongPressStart: (details) {
            _showDocContextMenu(context, note, details.globalPosition);
          },
          child: Container(
            margin: EdgeInsets.only(left: 6.0 + depth * 8.0),
            decoration: BoxDecoration(
              color: isSelected ? theme.colorScheme.primary.withOpacity(0.1) : null,
              border: depth > 0
                  ? Border(left: BorderSide(color: theme.dividerColor.withOpacity(0.4), width: 1))
                  : null,
            ),
            child: isRenaming
                ? _DocRenameTile(
                    initialName: note.title ?? '',
                    depth: depth,
                    note: note,
                    onSubmit: (newTitle) => _submitRename(note, newTitle),
                    onCancel: () => setState(() => _renamingId = null),
                  )
                : ListTile(
                    contentPadding: const EdgeInsets.only(right: 4),
                    dense: true,
                    visualDensity: VisualDensity.compact,
                    leading: Text(
                      note.readonly ? '🔒' : (docTypeIcons[note.docType] ?? '🧩'),
                      style: const TextStyle(fontSize: 14),
                    ),
                    title: Text(
                      note.title ?? '无标题',
                      style: TextStyle(
                        fontSize: 13,
                        color: theme.colorScheme.onSurface,
                        fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: note.docType != null && note.docType!.isNotEmpty
                        ? DocTypeBadge(
                            docType: note.docType,
                            readonly: note.readonly,
                          )
                        : null,
                    onTap: () => _onDocTap(note),
                  ),
          ),
        ),
      );
    }

    return widgets;
  }

  Future<void> _submitRename(Note note, String newTitle) async {
    if (newTitle.isEmpty || newTitle == note.title) {
      setState(() => _renamingId = null);
      return;
    }
    await context.read<NoteProvider>().updateNote(note, title: newTitle);
    context.read<NoteProvider>().loadPathTree();
    setState(() => _renamingId = null);
  }

  Future<void> _submitFolderRename(String oldPath, String newName) async {
    if (newName.isEmpty || newName == _folderName(oldPath)) {
      setState(() => _renamingFolder = null);
      return;
    }
    final parts = oldPath.split('/');
    final newPath = parts.length == 1
        ? newName
        : '${parts.sublist(0, parts.length - 1).join('/')}/$newName';
    await context.read<NoteProvider>().renameFolder(oldPath, newPath);
    setState(() => _renamingFolder = null);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Consumer<NoteProvider>(
      builder: (context, provider, _) {
        if (provider.loading && provider.pathTree.isEmpty) {
          return const Center(child: CircularProgressIndicator());
        }

        final pathTree = provider.pathTree;
        final allFolders = _buildAllFolders(pathTree);

        // 过滤出根目录
        final rootFolders = ['projects', 'areas', 'references', 'ideas', 'archives']
            .where((r) => allFolders.contains(r))
            .toList();

        return Scaffold(
          appBar: AppBar(
            title: const Text('文档'),
            actions: [
              IconButton(
                icon: const Icon(Icons.folder, size: 18),
                tooltip: '折叠所有目录',
                onPressed: () => _collapseAll(allFolders),
              ),
              IconButton(
                icon: const Icon(Icons.folder_open, size: 18),
                tooltip: '折叠其它目录（保留当前文档所在目录）',
                onPressed: _selectedId != null
                    ? () => _collapseOthers(pathTree, allFolders)
                    : null,
              ),
            ],
          ),
          body: rootFolders.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.description_outlined, size: 48, color: theme.disabledColor),
                      const SizedBox(height: 12),
                      Text(
                        '暂无文档',
                        style: TextStyle(color: theme.disabledColor, fontSize: 14),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '在笔记中设置文档路径即可在此查看',
                        style: TextStyle(color: theme.disabledColor, fontSize: 12),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () => provider.loadPathTree(),
                  child: ListView(
                    children: [
                      for (final root in rootFolders) ...[
                        GestureDetector(
                          onLongPressStart: (details) {
                            _showFolderContextMenu(context, root, details.globalPosition);
                          },
                          child: _renamingFolder == root
                              ? _FolderRenameTile(
                                  initialName: _folderName(root),
                                  depth: 0,
                                  folderPath: root,
                                  folderIcon: _folderIcon(root),
                                  onSubmit: (newName) => _submitFolderRename(root, newName),
                                  onCancel: () => setState(() => _renamingFolder = null),
                                )
                              : ExpansionTile(
                                  tilePadding: const EdgeInsets.only(left: 6),
                                  initiallyExpanded: !_collapsed.contains(root),
                                  leading: Text(
                                    (_getSubFolders(root, allFolders).isNotEmpty ||
                                            (pathTree[root]?.isNotEmpty ?? false))
                                        ? (_collapsed.contains(root) ? '▶' : '▼')
                                        : '  ',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: theme.colorScheme.onSurface,
                                    ),
                                  ),
                                  title: Row(
                                    children: [
                                      Text(_folderIcon(root), style: const TextStyle(fontSize: 14)),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: Text(
                                          root,
                                          style: TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600,
                                            color: theme.colorScheme.onSurface,
                                          ),
                                        ),
                                      ),
                                      if (_countDocsUnder(root, pathTree) > 0)
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                          decoration: BoxDecoration(
                                            color: theme.colorScheme.primary.withOpacity(0.15),
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: Text(
                                            '${_countDocsUnder(root, pathTree)}',
                                            style: TextStyle(
                                              fontSize: 11,
                                              color: theme.colorScheme.primary,
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                  onExpansionChanged: (expanded) {
                                    setState(() {
                                      if (expanded) {
                                        _collapsed.remove(root);
                                      } else {
                                        _collapsed.add(root);
                                      }
                                    });
                                  },
                                  children: _buildTree(root, 1, pathTree, allFolders, theme),
                                ),
                        ),
                      ],
                    ],
                  ),
                ),
        );
      },
    );
  }
}

// ── 行内重命名：文档 ──

class _DocRenameTile extends StatefulWidget {
  final String initialName;
  final int depth;
  final Note note;
  final Function(String) onSubmit;
  final VoidCallback onCancel;

  const _DocRenameTile({
    required this.initialName,
    required this.depth,
    required this.note,
    required this.onSubmit,
    required this.onCancel,
  });

  @override
  State<_DocRenameTile> createState() => _DocRenameTileState();
}

class _DocRenameTileState extends State<_DocRenameTile> {
  late TextEditingController _controller;
  late FocusNode _focusNode;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialName);
    _focusNode = FocusNode();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
      _controller.selection = TextSelection(
        baseOffset: 0,
        extentOffset: _controller.text.length,
      );
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: TextField(
        controller: _controller,
        focusNode: _focusNode,
        style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurface),
        decoration: InputDecoration(
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(4),
            borderSide: BorderSide(color: theme.colorScheme.primary),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(4),
            borderSide: BorderSide(color: theme.colorScheme.primary),
          ),
        ),
        onSubmitted: (v) => widget.onSubmit(v.trim()),
        onTapOutside: (_) => widget.onSubmit(_controller.text.trim()),
      ),
    );
  }
}

// ── 行内重命名：文件夹 ──

class _FolderRenameTile extends StatefulWidget {
  final String initialName;
  final int depth;
  final String folderPath;
  final String folderIcon;
  final Function(String) onSubmit;
  final VoidCallback onCancel;

  const _FolderRenameTile({
    required this.initialName,
    required this.depth,
    required this.folderPath,
    required this.folderIcon,
    required this.onSubmit,
    required this.onCancel,
  });

  @override
  State<_FolderRenameTile> createState() => _FolderRenameTileState();
}

class _FolderRenameTileState extends State<_FolderRenameTile> {
  late TextEditingController _controller;
  late FocusNode _focusNode;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialName);
    _focusNode = FocusNode();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
      _controller.selection = TextSelection(
        baseOffset: 0,
        extentOffset: _controller.text.length,
      );
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(left: 6.0 + widget.depth * 8.0, right: 4),
      child: Row(
        children: [
          Text('  ', style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface)),
          Text(widget.folderIcon, style: const TextStyle(fontSize: 14)),
          const SizedBox(width: 6),
          Expanded(
            child: TextField(
              controller: _controller,
              focusNode: _focusNode,
              style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurface),
              decoration: InputDecoration(
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(4),
                  borderSide: BorderSide(color: theme.colorScheme.primary),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(4),
                  borderSide: BorderSide(color: theme.colorScheme.primary),
                ),
              ),
              onSubmitted: (v) => widget.onSubmit(v.trim()),
              onTapOutside: (_) => widget.onSubmit(_controller.text.trim()),
            ),
          ),
        ],
      ),
    );
  }
}
