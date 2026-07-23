import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'dart:io' show File;
import '../providers/note_provider.dart';
import '../models/note.dart';
import 'note_editor_screen.dart';
import 'search_screen.dart';
import 'trash_screen.dart';
import 'doc_tree_screen.dart';
import 'concept_aggregation.dart';
import '../widgets/doc_create_dialog.dart';
import '../widgets/note_card.dart';
import '../widgets/todo_list_widget.dart';
import '../widgets/tag_filter_bar.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final String _selectedDate = DateFormat('yyyy-MM-dd').format(DateTime.now());
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  int _tabIndex = 0; // 0=随笔, 1=文档, 2=概念

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadData());
  }

  Future<void> _loadData() async {
    final provider = context.read<NoteProvider>();
    await provider.loadRecentDates();
    await provider.loadNotesByDate(_selectedDate);
    await provider.loadDailyPage(_selectedDate);
    await provider.loadAllTags();
  }

  Future<void> _navigateToEditor({Note? note}) async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => NoteEditorScreen(
          date: _selectedDate,
          note: note,
        ),
      ),
    );
    if (result == true && mounted) {
      await context.read<NoteProvider>().loadNotesByDate(_selectedDate);
    }
  }

  Future<void> _togglePin(Note note) async {
    await context.read<NoteProvider>().updateNote(note, pinned: !note.pinned);
  }

  Future<void> _deleteNote(Note note) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除笔记'),
        content: Text('确定删除「${note.title ?? '无标题'}」？'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('取消')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('删除', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirm == true && mounted) {
      await context.read<NoteProvider>().deleteNote(note.id, _selectedDate);
    }
  }

  void _showCreateDocDialog() {
    showDialog(
      context: context,
      builder: (_) => DocCreateDialog(
        onClose: () => Navigator.pop(context),
        onCreated: (_) {
          Navigator.pop(context);
          if (mounted) setState(() => _tabIndex = 1);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      key: _scaffoldKey,
      appBar: AppBar(
        title: Text(
          DateFormat('M月d日 EEEE', 'zh_CN').format(DateTime.parse(_selectedDate)),
          style: const TextStyle(fontSize: 18),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SearchScreen()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TrashScreen()),
            ),
          ),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'export') _exportNotes();
              if (v == 'import') _importNotes();
              if (v == 'mdimport') _importMarkdown();
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'export', child: Text('导出 JSON')),
              const PopupMenuItem(value: 'import', child: Text('导入 JSON')),
              const PopupMenuItem(value: 'mdimport', child: Text('导入 Markdown')),
            ],
          ),
        ],
      ),
      body: IndexedStack(
        index: _tabIndex,
        children: [
          _buildDailyTab(theme),
          const DocTreeScreen(),
          const ConceptAggregation(),
        ],
      ),
      floatingActionButton: _tabIndex == 0
          ? FloatingActionButton(
              onPressed: () => _navigateToEditor(),
              child: const Icon(Icons.add),
            )
          : _tabIndex == 1
              ? FloatingActionButton(
                  onPressed: _showCreateDocDialog,
                  child: const Icon(Icons.note_add),
                )
              : null,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (i) => setState(() => _tabIndex = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.edit_note), label: '随笔'),
          NavigationDestination(icon: Icon(Icons.folder_outlined), label: '文档'),
          NavigationDestination(icon: Icon(Icons.label_outline), label: '概念'),
        ],
      ),
    );
  }

  Widget _buildDailyTab(ThemeData theme) {
    return Consumer<NoteProvider>(
      builder: (context, provider, _) {
        if (provider.loading) {
          return const Center(child: CircularProgressIndicator());
        }

        final notes = provider.notesByDate[_selectedDate] ?? [];
        final dailyPage = provider.currentDailyPage;

        return RefreshIndicator(
          onRefresh: _loadData,
          child: CustomScrollView(
            slivers: [
              if (dailyPage != null)
                SliverToBoxAdapter(
                  child: TodoListWidget(
                    dailyPage: dailyPage,
                    onUpdate: (todos) =>
                        provider.updateTodos(_selectedDate, todos),
                    onToggleCarryover: (v) =>
                        provider.setTodoCarryover(_selectedDate, v),
                  ),
                ),
              if (provider.allTags.isNotEmpty)
                SliverToBoxAdapter(
                  child: TagFilterBar(
                    allTags: provider.allTags,
                    onSelectTag: (tag) => provider.filterByTag(tag),
                    onClear: () => provider.clearTagFilter(),
                  ),
                ),
              SliverPadding(
                padding: const EdgeInsets.all(8),
                sliver: notes.isEmpty
                    ? SliverFillRemaining(
                        child: Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.edit_note,
                                  size: 64, color: theme.disabledColor),
                              const SizedBox(height: 16),
                              Text(
                                '今天还没有笔记\n点击右下角 + 开始记录',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: theme.disabledColor),
                              ),
                            ],
                          ),
                        ),
                      )
                    : SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (context, index) {
                            final note = notes[index];
                            return NoteCard(
                              note: note,
                              onTap: () => _navigateToEditor(note: note),
                              onPin: () => _togglePin(note),
                              onDelete: () => _deleteNote(note),
                            );
                          },
                          childCount: notes.length,
                        ),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _exportNotes() async {
    final provider = context.read<NoteProvider>();
    try {
      final json = await provider.exportAll();
      if (!mounted) return;

      // 桌面端：弹出文件保存对话框
      final path = await FilePicker.platform.saveFile(
        dialogTitle: '导出便签数据',
        fileName: 'nine-rings-${DateFormat('yyyy-MM-dd').format(DateTime.now())}.json',
        type: FileType.custom,
        allowedExtensions: ['json'],
      );
      if (path != null) {
        await File(path).writeAsString(json);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('导出成功 → $path')),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('导出失败: $e')),
      );
    }
  }

  Future<void> _importNotes() async {
    if (!context.mounted) return;
    try {
      final result = await FilePicker.platform.pickFiles(
        dialogTitle: '导入便签数据',
        type: FileType.custom,
        allowedExtensions: ['json'],
        allowMultiple: false,
      );
      if (result == null || result.files.isEmpty) return; // 用户取消

      final file = result.files.single;
      String json;
      if (file.path != null) {
        json = await File(file.path!).readAsString();
      } else if (file.bytes != null) {
        json = String.fromCharCodes(file.bytes!);
      } else {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('无法读取文件内容')),
        );
        return;
      }

      final provider = context.read<NoteProvider>();
      final count = await provider.importBundle(json);

      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('导入完成：$count 篇笔记')),
      );
      await provider.loadRecentDates();
      if (mounted) provider.notifyListeners();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('导入失败: $e')),
      );
    }
  }

  Future<void> _importMarkdown() async {
    if (!context.mounted) return;
    try {
      final result = await FilePicker.platform.pickFiles(
        dialogTitle: '导入 Markdown 文件',
        type: FileType.custom,
        allowedExtensions: ['md', 'markdown'],
        allowMultiple: true,
      );
      if (result == null || result.files.isEmpty) return;

      final provider = context.read<NoteProvider>();
      final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
      int count = 0;

      for (final file in result.files) {
        String text;
        if (file.path != null) {
          text = await File(file.path!).readAsString();
        } else if (file.bytes != null) {
          text = String.fromCharCodes(file.bytes!);
        } else {
          continue;
        }

        final title = provider.extractTitle(
          text,
          file.name.replaceAll(RegExp(r'\.md$'), ''),
        );
        final delta = provider.mdToDelta(text);

        await provider.createNote(
          date: today,
          title: title,
          content: delta,
        );
        count++;
      }

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Markdown 导入完成：$count 篇笔记')),
      );
      await provider.loadRecentDates();
      await provider.loadNotesByDate(today);
      if (mounted) provider.notifyListeners();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Markdown 导入失败: $e')),
      );
    }
  }
}
