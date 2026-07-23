import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../models/note.dart';
import '../constants/doc_constants.dart';
import '../services/template_service.dart';

/// 新建文档对话框 — 匹配 Tauri DocCreateDialog.tsx 设计
class DocCreateDialog extends StatefulWidget {
  final VoidCallback onClose;
  final Function(Note) onCreated;

  const DocCreateDialog({
    super.key,
    required this.onClose,
    required this.onCreated,
  });

  @override
  State<DocCreateDialog> createState() => _DocCreateDialogState();
}

class _DocCreateDialogState extends State<DocCreateDialog> {
  final _titleController = TextEditingController();
  final _conceptController = TextEditingController();
  final _subPathController = TextEditingController();
  final _titleFocus = FocusNode();

  String _rootPath = 'projects';
  String _docType = 'explanation';
  List<String> _concepts = [];
  List<String> _existingConcepts = [];
  List<String> _filteredSuggestions = [];
  List<Template> _templates = [];
  String? _activeTemplateId;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _titleFocus.requestFocus();
      _loadData();
    });
  }

  Future<void> _loadData() async {
    final provider = context.read<NoteProvider>();
    await provider.loadAllConcepts();
    if (mounted) {
      setState(() => _existingConcepts = provider.allConcepts);
    }

    // 加载模板
    final templateService = TemplateService();
    await templateService.seedBuiltinTemplates();
    final list = await templateService.listTemplates();
    if (mounted) {
      setState(() {
        _templates = list;
        final blank = list.where((t) => t.id == 'builtin-blank').firstOrNull;
        if (blank != null) _activeTemplateId = blank.id;
      });
    }
  }

  // ── 模板选择 ──
  void _handleTemplateSelect(Template template) {
    setState(() {
      _activeTemplateId = template.id;
    });

    // 提取模板元数据
    final rawPath = (template.storagePath ?? '').replaceFirst(RegExp(r'^/+'), '');
    final parts = rawPath.isNotEmpty ? rawPath.split('/') : <String>[];

    final newRootPath = parts.isNotEmpty ? parts[0] : 'projects';
    final newSubPath = parts.length > 1 ? parts.sublist(1).join('/') : '';

    // 验证 rootPath 是否合法
    final validRoots = ['projects', 'areas', 'references', 'ideas', 'archives'];
    setState(() {
      _titleController.text = template.titleTemplate ?? '';
      _rootPath = validRoots.contains(newRootPath) ? newRootPath : 'projects';
      _subPathController.text = newSubPath;
      if (template.docType != null) _docType = template.docType!;
      if (template.concepts.isNotEmpty) _concepts = List.from(template.concepts);
    });
  }

  // ── 概念输入 ──
  void _handleConceptChange(String value) {
    _conceptController.text = value;
    _conceptController.selection = TextSelection.fromPosition(
      TextPosition(offset: value.length),
    );
    if (value.trim().isNotEmpty) {
      setState(() {
        _filteredSuggestions = _existingConcepts
            .where((c) => c.contains(value.trim()) && !_concepts.contains(c))
            .toList();
      });
    } else {
      setState(() => _filteredSuggestions = []);
    }
  }

  void _addConcept(String tag) {
    final t = tag.trim();
    if (t.isNotEmpty && !_concepts.contains(t)) {
      setState(() => _concepts = [..._concepts, t]);
    }
    _conceptController.clear();
    setState(() => _filteredSuggestions = []);
  }

  void _removeConcept(String tag) {
    setState(() => _concepts = _concepts.where((c) => c != tag).toList());
  }

  String _buildStoragePath() {
    final parts = <String>[_rootPath];
    if (_subPathController.text.trim().isNotEmpty) {
      parts.add(_subPathController.text
          .trim()
          .replaceAll(RegExp(r'[^a-zA-Z0-9\-\u4e00-\u9fff]'), '-')
          .replaceAll(RegExp(r'-+'), '-'));
    }
    return parts.join('/');
  }

  Future<void> _handleSubmit() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;

    setState(() => _saving = true);
    try {
      final storagePath = _buildStoragePath();
      final today = DateFormat('yyyy-MM-dd').format(DateTime.now());

      final note = await context.read<NoteProvider>().createNote(
        date: today,
        title: title,
        content: '[]',
        tags: [],
        storagePath: storagePath,
        docType: _docType,
        concepts: _concepts.isNotEmpty ? _concepts : null,
      );

      if (note != null && mounted) {
        widget.onCreated(note);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('创建失败: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _conceptController.dispose();
    _subPathController.dispose();
    _titleFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      backgroundColor: theme.cardColor,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 500, maxHeight: 700),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: theme.dividerColor),
                ),
              ),
              child: Row(
                children: [
                  Text(
                    '新建文档',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                  const Spacer(),
                  InkWell(
                    onTap: widget.onClose,
                    child: Icon(Icons.close, size: 18, color: theme.disabledColor),
                  ),
                ],
              ),
            ),

            // Body
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // ── 模板选择 ──
                    if (_templates.isNotEmpty) ...[
                      _buildFieldLabel(theme, '模板'),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: _templates.map((t) => _buildTemplateChip(theme, t)).toList(),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // ── 标题 ──
                    _buildFieldLabel(theme, '标题'),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _titleController,
                      focusNode: _titleFocus,
                      style: TextStyle(fontSize: 14, color: theme.colorScheme.onSurface),
                      decoration: InputDecoration(
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        hintText: '文档标题...',
                        hintStyle: TextStyle(fontSize: 14, color: theme.disabledColor),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: BorderSide(color: theme.dividerColor),
                        ),
                      ),
                      onSubmitted: (_) => _handleSubmit(),
                    ),
                    const SizedBox(height: 16),

                    // ── 位置（P.A.R.A.） ──
                    _buildFieldLabel(theme, '位置', hint: '（仅决定存放，可更改）'),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(
                          flex: 3,
                          child: DropdownButtonFormField<String>(
                            value: _rootPath,
                            isDense: true,
                            decoration: InputDecoration(
                              isDense: true,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: BorderSide(color: theme.dividerColor),
                              ),
                            ),
                            items: docCreatePathOptions.map((o) => DropdownMenuItem(
                              value: o.value,
                              child: Text('${o.label} — ${o.desc}', style: const TextStyle(fontSize: 12)),
                            )).toList(),
                            onChanged: (v) {
                              if (v != null) setState(() => _rootPath = v);
                            },
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          child: Text('/', style: TextStyle(color: theme.disabledColor)),
                        ),
                        Expanded(
                          flex: 4,
                          child: TextField(
                            controller: _subPathController,
                            style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurface),
                            decoration: InputDecoration(
                              isDense: true,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              hintText: '子路径 (如 nine-rings)',
                              hintStyle: TextStyle(fontSize: 12, color: theme.disabledColor),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: BorderSide(color: theme.dividerColor),
                              ),
                            ),
                            onChanged: (_) => setState(() {}),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '预览: ${_buildStoragePath()}',
                      style: TextStyle(fontSize: 11, color: theme.disabledColor, fontFamily: 'monospace'),
                    ),
                    const SizedBox(height: 16),

                    // ── 类型（Diátaxis） ──
                    _buildFieldLabel(theme, '类型'),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: docTypeOptions.map((o) => _buildTypeRadio(theme, o)).toList(),
                    ),
                    const SizedBox(height: 16),

                    // ── 概念标签 ──
                    _buildFieldLabel(theme, '概念标签', hint: '（关联查找用）'),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _conceptController,
                      style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurface),
                      decoration: InputDecoration(
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        hintText: '输入概念名后按 Enter 添加...',
                        hintStyle: TextStyle(fontSize: 13, color: theme.disabledColor),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: BorderSide(color: theme.dividerColor),
                        ),
                      ),
                      onChanged: _handleConceptChange,
                      onSubmitted: (v) => _addConcept(v),
                    ),
                    if (_filteredSuggestions.isNotEmpty)
                      Container(
                        margin: const EdgeInsets.only(top: 2),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: theme.dividerColor),
                          color: theme.cardColor,
                        ),
                        constraints: const BoxConstraints(maxHeight: 120),
                        child: ListView(
                          shrinkWrap: true,
                          padding: EdgeInsets.zero,
                          children: _filteredSuggestions.map((s) => InkWell(
                            onTap: () => _addConcept(s),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              child: Text(s, style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurface)),
                            ),
                          )).toList(),
                        ),
                      ),
                    if (_concepts.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: _concepts.map((c) => _buildConceptChip(theme, c)).toList(),
                      ),
                    ],
                  ],
                ),
              ),
            ),

            // Footer
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(color: theme.dividerColor),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: widget.onClose,
                    child: Text('取消', style: TextStyle(color: theme.disabledColor)),
                  ),
                  const SizedBox(width: 12),
                  FilledButton(
                    onPressed: (_titleController.text.trim().isEmpty || _saving)
                        ? null
                        : _handleSubmit,
                    child: Text(_saving ? '创建中...' : '创建'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFieldLabel(ThemeData theme, String label, {String? hint}) {
    return Row(
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: theme.colorScheme.onSurface,
          ),
        ),
        if (hint != null) ...[
          const SizedBox(width: 4),
          Text(hint, style: TextStyle(fontSize: 11, color: theme.disabledColor)),
        ],
      ],
    );
  }

  Widget _buildTemplateChip(ThemeData theme, Template template) {
    final isActive = _activeTemplateId == template.id;
    final icon = switch (template.id) {
      'builtin-meeting' => '📋',
      'builtin-reading' => '📖',
      'builtin-project' => '🚀',
      'builtin-idea' => '💡',
      'builtin-todo' => '✅',
      'builtin-knowledge' => '🧠',
      'builtin-weekly' => '📊',
      _ => '📄',
    };
    return InkWell(
      onTap: () => _handleTemplateSelect(template),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          color: isActive ? theme.colorScheme.primary.withOpacity(0.15) : null,
          border: Border.all(
            color: isActive ? theme.colorScheme.primary : theme.dividerColor.withOpacity(0.5),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(icon, style: const TextStyle(fontSize: 13)),
            const SizedBox(width: 4),
            Text(
              template.name,
              style: TextStyle(
                fontSize: 12,
                color: isActive ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTypeRadio(ThemeData theme, DocTypeOption option) {
    final isSelected = _docType == option.value;
    return InkWell(
      onTap: () => setState(() => _docType = option.value),
      child: Container(
        width: (MediaQuery.of(context).size.width - 80) / 2,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          color: isSelected ? theme.colorScheme.primary.withOpacity(0.1) : null,
          border: Border.all(
            color: isSelected ? theme.colorScheme.primary : theme.dividerColor.withOpacity(0.5),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              option.label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                color: isSelected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              option.desc,
              style: TextStyle(fontSize: 11, color: theme.disabledColor),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConceptChip(ThemeData theme, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        color: theme.colorScheme.primary.withOpacity(0.1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: TextStyle(fontSize: 11, color: theme.colorScheme.primary)),
          const SizedBox(width: 4),
          InkWell(
            onTap: () => _removeConcept(label),
            child: Icon(Icons.close, size: 12, color: theme.colorScheme.primary),
          ),
        ],
      ),
    );
  }
}
