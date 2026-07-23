import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../models/note.dart';
import '../widgets/tag_editor.dart';
import '../widgets/doc_type_badge.dart';
import 'properties_panel.dart';

/// 字体大小 named → px 映射（用于统计栏显示，与 Web 端 delta-converter.ts 一致）
int namedToPx(String name) {
  switch (name) {
    case 'small':
      return 14;
    case 'normal':
      return 16;
    case 'large':
      return 18;
    case 'huge':
      return 24;
    default:
      return 16;
  }
}

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
  bool get _isDocument => widget.note?.storagePath != null;

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
        _quillController.addListener(_onChange);
      } catch (_) {
        _quillController = QuillController.basic();
        _quillController.addListener(_onChange);
      }
    } else {
      _quillController = QuillController.basic();
      _quillController.addListener(_onChange);
    }
  }

  @override
  void dispose() {
    _quillController.removeListener(_onChange);
    _quillController.dispose();
    _titleController.dispose();
    super.dispose();
  }

  /// Listen for changes (used for word count refresh)
  void _onChange() {
    if (mounted) setState(() {});
  }

  /// 字数统计
  int get _charCount {
    try {
      final text = _quillController.document.toPlainText();
      return text.replaceAll('\n', '').length;
    } catch (_) {
      return 0;
    }
  }

  int get _wordCount {
    try {
      final text = _quillController.document.toPlainText().trim();
      return text.isEmpty ? 0 : text.split(RegExp(r'\s+')).length;
    } catch (_) {
      return 0;
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    final picker = ImagePicker();
    final xFile = await picker.pickImage(source: source, maxWidth: 1024);
    if (xFile == null) return;

    final bytes = await xFile.readAsBytes();
    final base64 = base64Encode(bytes);
    final mimeType = xFile.name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    final dataUri = 'data:$mimeType;base64,$base64';

    final index = _quillController.selection.baseOffset;
    _quillController.document.insert(
      index,
      BlockEmbed.image(dataUri),
    );
  }

  void _showImagePickerDialog() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: const Text('从相册选择'),
              onTap: () {
                Navigator.pop(ctx);
                _pickImage(ImageSource.gallery);
              },
            ),
            ListTile(
              leading: const Icon(Icons.camera_alt),
              title: const Text('拍照'),
              onTap: () {
                Navigator.pop(ctx);
                _pickImage(ImageSource.camera);
              },
            ),
          ],
        ),
      ),
    );
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

  /// 打开属性面板（仅文档模式）
  void _showProperties() {
    if (!_isEditing || widget.note == null || !_isDocument) return;
    final note = widget.note!;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, scrollController) => PropertiesPanel(
          note: note,
          onClose: () => Navigator.pop(context),
        ),
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
    final theme = Theme.of(context);
    final note = widget.note;
    final isDoc = _isDocument;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEditing ? '编辑笔记' : '新建笔记'),
        actions: [
          // ── 属性面板入口（仅文档）──
          if (_isEditing && isDoc)
            IconButton(
              icon: const Icon(Icons.info_outline),
              tooltip: '属性',
              onPressed: _showProperties,
            ),
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
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.check),
            onPressed: _save,
          ),
        ],
      ),
      body: Column(
        children: [
          // ── 文档元数据栏（仅文档模式）──
          if (_isEditing && isDoc && note != null)
            _buildDocMetaBar(theme, note),

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

          // Quill editor toolbar + image button
          QuillSimpleToolbar(
            controller: _quillController,
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: IconButton(
                icon: const Icon(Icons.image, size: 20),
                tooltip: '插入图片',
                onPressed: _showImagePickerDialog,
                constraints:
                    const BoxConstraints(minWidth: 32, minHeight: 32),
                padding: EdgeInsets.zero,
              ),
            ),
          ),

          // Quill editor body
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: QuillEditor.basic(
                controller: _quillController,
              ),
            ),
          ),

          // ── 字数统计 ──
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            decoration: BoxDecoration(
              border: Border(
                  top: BorderSide(color: Theme.of(context).dividerColor)),
            ),
            child: Row(
              children: [
                Text(
                  '$_charCount 字符 | $_wordCount 词',
                  style: TextStyle(
                    fontSize: 11,
                    color: Theme.of(context).disabledColor,
                  ),
                ),
                const Spacer(),
                Text(
                  '图片/字号/颜色均支持',
                  style: TextStyle(
                    fontSize: 11,
                    color: Theme.of(context)
                        .disabledColor
                        .withValues(alpha: 0.6),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// 文档元数据栏：只读标记 + 类型徽章 + 概念标签 + 路径
  Widget _buildDocMetaBar(ThemeData theme, Note note) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 只读 + 类型
          Row(
            children: [
              if (note.readonly)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Icon(Icons.lock,
                      size: 14, color: theme.colorScheme.error),
                ),
              DocTypeBadge(
                docType: note.docType,
                readonly: note.readonly,
              ),
              if (note.storagePath != null) ...[
                const SizedBox(width: 8),
                Icon(Icons.folder_outlined,
                    size: 14, color: theme.disabledColor),
                const SizedBox(width: 2),
                Expanded(
                  child: Text(
                    note.storagePath!,
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.disabledColor,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ],
          ),
          // 概念标签
          if (note.concepts != null && note.concepts!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Wrap(
              spacing: 4,
              runSpacing: 2,
              children: note.concepts!
                  .map((c) => Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.secondaryContainer,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          c,
                          style: TextStyle(
                            fontSize: 10,
                            color: theme.colorScheme.onSecondaryContainer,
                          ),
                        ),
                      ))
                  .toList(),
            ),
          ],
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
                          title: Text(
                              v.title.isNotEmpty ? v.title : '(无标题)'),
                          subtitle: Text(
                            '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} '
                            '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}',
                          ),
                          trailing: TextButton(
                            onPressed: () async {
                              await provider.restoreVersion(
                                  noteId, v.id, date);
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
