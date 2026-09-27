import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'dart:io' show File;
import '../providers/note_provider.dart';
import 'search_screen.dart';
import 'trash_screen.dart';
import 'doc_tree_screen.dart';
import 'concept_aggregation.dart';
import 'settings_screen.dart';
import '../widgets/doc_create_dialog.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  int _tabIndex = 0; // 0=文档, 1=概念

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadData());
  }

  Future<void> _loadData() async {
    final provider = context.read<NoteProvider>();
    await provider.loadRecentDates();
    await provider.loadAllTags();
  }

  void _showCreateDocDialog() {
    showDialog(
      context: context,
      builder: (_) => DocCreateDialog(
        onClose: () => Navigator.pop(context),
        onCreated: (_) {
          Navigator.pop(context);
          if (mounted) setState(() => _tabIndex = 0);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      appBar: AppBar(
        title: const Text(
          '文档工作区',
          style: TextStyle(fontSize: 18),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: '设置',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            ),
          ),
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
          const DocTreeScreen(),
          const ConceptAggregation(),
        ],
      ),
      floatingActionButton: _tabIndex == 0
          ? FloatingActionButton(
              onPressed: _showCreateDocDialog,
              child: const Icon(Icons.note_add),
            )
          : null,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (i) => setState(() => _tabIndex = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.folder_outlined), label: '文档'),
          NavigationDestination(icon: Icon(Icons.label_outline), label: '概念'),
        ],
      ),
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
        SnackBar(content: Text('导入完成：${count.notesImported} 篇文档')),
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
