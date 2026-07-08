import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../models/note.dart';
import 'note_editor_screen.dart';
import 'search_screen.dart';
import 'trash_screen.dart';
import '../widgets/note_card.dart';
import '../widgets/todo_list_widget.dart';
import '../widgets/tag_filter_bar.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String _selectedDate = DateFormat('yyyy-MM-dd').format(DateTime.now());
  final _scaffoldKey = GlobalKey<ScaffoldState>();

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
    if (result == true) {
      await context.read<NoteProvider>().loadNotesByDate(_selectedDate);
    }
  }

  Future<void> _togglePin(Note note) async {
    await context.read<NoteProvider>().updateNote(
      note,
      pinned: !note.pinned,
    );
  }

  Future<void> _deleteNote(Note note) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除笔记'),
        content: Text('确定删除「${note.title ?? '无标题'}」？'),
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
      await context.read<NoteProvider>().deleteNote(note.id, _selectedDate);
    }
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
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'export', child: Text('导出')),
              const PopupMenuItem(value: 'import', child: Text('导入')),
            ],
          ),
        ],
      ),
      body: Consumer<NoteProvider>(
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
                // ── Daily page: todos ──
                if (dailyPage != null)
                  SliverToBoxAdapter(
                    child: TodoListWidget(
                      dailyPage: dailyPage,
                      onUpdate: (todos) => provider.updateTodos(_selectedDate, todos),
                      onToggleCarryover: (v) => provider.setTodoCarryover(_selectedDate, v),
                    ),
                  ),

                // ── Tags filter ──
                if (provider.allTags.isNotEmpty)
                  SliverToBoxAdapter(
                    child: TagFilterBar(
                      allTags: provider.allTags,
                      onSelectTag: (tag) => provider.filterByTag(tag),
                      onClear: () => provider.clearTagFilter(),
                    ),
                  ),

                // ── Notes ──
                SliverPadding(
                  padding: const EdgeInsets.all(8),
                  sliver: notes.isEmpty
                      ? SliverFillRemaining(
                          child: Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.edit_note, size: 64, color: theme.disabledColor),
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
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _navigateToEditor(),
        child: const Icon(Icons.add),
      ),
    );
  }

  Future<void> _exportNotes() async {
    final provider = context.read<NoteProvider>();
    try {
      final json = await provider.exportAll();
      // In a real app, use share_plus to share the file
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('导出成功 (${json.length} 字符)')),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('导出失败: $e')),
      );
    }
  }

  Future<void> _importNotes() async {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('导入功能需配合文件选择器使用')),
    );
  }
}
