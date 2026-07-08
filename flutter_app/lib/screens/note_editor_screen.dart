import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../models/note.dart';
import '../widgets/tag_editor.dart';

class NoteEditorScreen extends StatefulWidget {
  final String date;
  final Note? note;

  const NoteEditorScreen({
    super.key,
    required this.date,
    this.note,
  });

  @override
  State<NoteEditorScreen> createState() => _NoteEditorScreenState();
}

class _NoteEditorScreenState extends State<NoteEditorScreen> {
  late QuillController _quillController;
  late TextEditingController _titleController;
  List<String> _tags = [];
  bool _saving = false;

  bool get _isEditing => widget.note != null;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.note?.title ?? '');
    _tags = widget.note != null ? List.from(widget.note!.tags) : [];

    // Initialize Quill controller from existing Delta
    if (widget.note != null && widget.note!.content.isNotEmpty) {
      try {
        final delta = jsonDecode(widget.note!.content);
        _quillController = QuillController(
          document: Document.fromJson(delta),
          selection: const TextSelection.collapsed(offset: 0),
        );
      } catch (_) {
        _quillController = QuillController.basic();
      }
    } else {
      _quillController = QuillController.basic();
    }
  }

  @override
  void dispose() {
    _quillController.dispose();
    _titleController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _saving = true);

    final provider = context.read<NoteProvider>();
    final deltaJson = jsonEncode(_quillController.document.toDelta().toJson());
    final title = _titleController.text.trim().isEmpty
        ? null
        : _titleController.text.trim();

    try {
      if (_isEditing) {
        await provider.updateNote(
          widget.note!,
          title: title,
          content: deltaJson,
          tags: _tags,
        );
      } else {
        await provider.createNote(
          date: widget.date,
          title: title,
          content: deltaJson,
          tags: _tags,
        );
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('保存失败: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _showVersionHistory() async {
    if (!_isEditing) return;
    final provider = context.read<NoteProvider>();
    await provider.loadVersions(widget.note!.id);
    if (!mounted) return;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _VersionHistorySheet(
        noteId: widget.note!.id,
        date: widget.date,
      ),
    );
  }

  Future<void> _exportMarkdown() async {
    final provider = context.read<NoteProvider>();
    final md = provider.deltaToMarkdown(
      jsonEncode(_quillController.document.toDelta().toJson()),
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Markdown 已生成 (${md.length} 字符)')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEditing ? '编辑笔记' : '新建笔记'),
        actions: [
          if (_isEditing)
            IconButton(
              icon: const Icon(Icons.history),
              tooltip: '版本历史',
              onPressed: _showVersionHistory,
            ),
          IconButton(
            icon: const Icon(Icons.description),
            tooltip: '导出 Markdown',
            onPressed: _exportMarkdown,
          ),
          IconButton(
            icon: _saving
                ? const SizedBox(
                    width: 20, height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.check),
            onPressed: _save,
          ),
        ],
      ),
      body: Column(
        children: [
          // Title
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                hintText: '标题（选填）',
                border: InputBorder.none,
                contentPadding: EdgeInsets.zero,
              ),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          ),

          // Tags
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TagEditor(
              tags: _tags,
              onChanged: (tags) => setState(() => _tags = tags),
            ),
          ),

          const Divider(),

          // Quill editor toolbar
          QuillSimpleToolbar(controller: _quillController),

          // Quill editor body
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: QuillEditor.basic(
                controller: _quillController,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Version History Bottom Sheet ──

class _VersionHistorySheet extends StatelessWidget {
  final String noteId;
  final String date;

  const _VersionHistorySheet({required this.noteId, required this.date});

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      builder: (ctx, scrollController) {
        return Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('版本历史', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Expanded(
                child: Consumer<NoteProvider>(
                  builder: (context, provider, _) {
                    final versions = provider.versions;
                    if (versions.isEmpty) {
                      return const Center(child: Text('暂无历史版本'));
                    }
                    return ListView.builder(
                      controller: scrollController,
                      itemCount: versions.length,
                      itemBuilder: (ctx, i) {
                        final v = versions[i];
                        final dt = DateTime.parse(v.createdAt);
                        return ListTile(
                          title: Text(v.title.isNotEmpty ? v.title : '(无标题)'),
                          subtitle: Text(
                            '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} '
                            '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}',
                          ),
                          trailing: TextButton(
                            onPressed: () async {
                              await provider.restoreVersion(noteId, v.id, date);
                              if (ctx.mounted) Navigator.pop(ctx);
                            },
                            child: const Text('恢复'),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
