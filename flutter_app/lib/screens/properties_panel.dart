import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../models/note.dart';
import '../constants/doc_constants.dart';

/// 文档属性编辑面板 — 匹配 Tauri PropertiesPanel.tsx 设计
class PropertiesPanel extends StatefulWidget {
  final Note note;
  final VoidCallback onClose;

  const PropertiesPanel({
    super.key,
    required this.note,
    required this.onClose,
  });

  @override
  State<PropertiesPanel> createState() => _PropertiesPanelState();
}

class _PropertiesPanelState extends State<PropertiesPanel> {
  final _conceptController = TextEditingController();
  final _linkSearchController = TextEditingController();
  final _focusNode = FocusNode();

  List<String> _existingConcepts = [];
  List<String> _suggestions = [];
  List<Note> _linkResults = [];
  List<Note> _backlinks = [];
  Set<String> _linkedDocIds = {};

  bool _editingPath = false;
  String _editRoot = '';
  String _editSub = '';

  Note get _note => widget.note;

  @override
  void initState() {
    super.initState();
    final parts = (_note.storagePath ?? '').split('/');
    _editRoot = parts.isNotEmpty && parts[0].isNotEmpty ? parts[0] : 'projects';
    _editSub = parts.length > 1 ? parts.sublist(1).join('/') : '';
    _linkedDocIds = Set.from(_note.linkedDocIds ?? []);
    _loadData();
  }

  Future<void> _loadData() async {
    final provider = context.read<NoteProvider>();
    await provider.loadAllConcepts();
    await provider.loadBacklinks(_note.id);
    if (mounted) {
      setState(() {
        _existingConcepts = provider.allConcepts;
        _backlinks = provider.backlinks;
      });
    }
  }

  // ── 概念输入 ──
  void _onConceptInput(String value) {
    _conceptController.text = value;
    _conceptController.selection = TextSelection.fromPosition(
      TextPosition(offset: value.length),
    );
    if (value.trim().isNotEmpty) {
      final concepts = _note.concepts ?? [];
      setState(() {
        _suggestions = _existingConcepts
            .where((c) => c.contains(value.trim()) && !concepts.contains(c))
            .toList();
      });
    } else {
      setState(() => _suggestions = []);
    }
  }

  Future<void> _addConcept(String tag) async {
    final t = tag.trim();
    if (t.isEmpty) return;
    final concepts = List<String>.from(_note.concepts ?? []);
    if (concepts.contains(t)) return;

    final updatedNote = _note.copyWith(concepts: [...concepts, t]);
    await context.read<NoteProvider>().updateNote(
      _note,
      concepts: updatedNote.concepts,
    );
    if (mounted) {
      setState(() {
        _conceptController.clear();
        _suggestions = [];
        _existingConcepts = [..._existingConcepts, t];
      });
    }
  }

  Future<void> _removeConcept(String tag) async {
    final concepts = List<String>.from(_note.concepts ?? []);
    concepts.remove(tag);
    await context.read<NoteProvider>().updateNote(_note, concepts: concepts);
  }

  // ── 类型变更（toggle） ──
  Future<void> _handleTypeChange(String docType) async {
    final newType = _note.docType == docType ? null : docType;
    await context.read<NoteProvider>().updateNote(_note, docType: newType);
  }

  // ── 路径变更 ──
  Future<void> _handlePathChange() async {
    final parts = <String>[_editRoot];
    if (_editSub.trim().isNotEmpty) {
      final cleaned = _editSub
          .trim()
          .replaceAll(RegExp(r'[^a-zA-Z0-9\-\u4e00-\u9fff]'), '-')
          .replaceAll(RegExp(r'-+'), '-');
      parts.add(cleaned);
    }
    final newPath = parts.join('/');
    if (newPath == _note.storagePath) {
      setState(() => _editingPath = false);
      return;
    }
    await context.read<NoteProvider>().updateNote(_note, storagePath: newPath);
    setState(() => _editingPath = false);
  }

  void _startEditPath() {
    final parts = (_note.storagePath ?? '').split('/');
    setState(() {
      _editRoot = parts.isNotEmpty && parts[0].isNotEmpty ? parts[0] : 'projects';
      _editSub = parts.length > 1 ? parts.sublist(1).join('/') : '';
      _editingPath = true;
    });
  }

  // ── 链接文档 ──
  Future<void> _onLinkSearch(String value) async {
    _linkSearchController.text = value;
    _linkSearchController.selection = TextSelection.fromPosition(
      TextPosition(offset: value.length),
    );
    if (value.trim().length >= 1) {
      final provider = context.read<NoteProvider>();
      final results = await provider.searchDocs(text: value.trim());
      if (mounted) {
        setState(() {
          _linkResults = results
              .where((n) => n.id != _note.id && !_linkedDocIds.contains(n.id))
              .toList();
        });
      }
    } else {
      setState(() => _linkResults = []);
    }
  }

  Future<void> _addLink(Note linkedNote) async {
    final updated = List<String>.from(_linkedDocIds)..add(linkedNote.id);
    await context.read<NoteProvider>().updateNote(_note, linkedDocIds: updated);
    setState(() {
      _linkedDocIds = Set.from(updated);
      _linkSearchController.clear();
      _linkResults = [];
    });
  }

  Future<void> _removeLink(String id) async {
    final updated = List<String>.from(_linkedDocIds)..remove(id);
    await context.read<NoteProvider>().updateNote(_note, linkedDocIds: updated);
    setState(() => _linkedDocIds = Set.from(updated));
  }

  @override
  void dispose() {
    _conceptController.dispose();
    _linkSearchController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final concepts = _note.concepts ?? [];
    final pathRoot = (_note.storagePath ?? '').split('/').firstOrNull ?? '';
    final pathRest = (_note.storagePath ?? '').split('/').length > 1
        ? (_note.storagePath ?? '').split('/').sublist(1).join('/')
        : '';

    return Container(
      width: 300,
      color: theme.cardColor,
      child: Column(
        children: [
          // Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(color: theme.dividerColor),
              ),
            ),
            child: Row(
              children: [
                Text(
                  '属性',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: theme.colorScheme.onSurface,
                  ),
                ),
                const Spacer(),
                InkWell(
                  onTap: widget.onClose,
                  child: const Icon(Icons.close, size: 16),
                ),
              ],
            ),
          ),

          // Body
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── 位置 ──
                  _buildSectionLabel(theme, '位置'),
                  const SizedBox(height: 4),
                  if (_editingPath)
                    _buildPathEditor(theme)
                  else
                    _buildPathDisplay(theme, pathRoot, pathRest),
                  const SizedBox(height: 16),

                  // ── 类型 ──
                  _buildSectionLabel(theme, '类型'),
                  const SizedBox(height: 4),
                  _buildTypeRadios(theme),
                  const SizedBox(height: 16),

                  // ── 概念标签 ──
                  _buildSectionLabel(theme, '概念'),
                  const SizedBox(height: 4),
                  _buildConceptInput(theme),
                  if (concepts.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: concepts.map((c) => _buildChip(theme, c, () => _removeConcept(c))).toList(),
                    ),
                  ],
                  const SizedBox(height: 16),

                  // ── 关联文档 ──
                  Row(
                    children: [
                      Text('关联文档', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: theme.colorScheme.onSurface)),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primary.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${_linkedDocIds.length}',
                          style: TextStyle(fontSize: 10, color: theme.colorScheme.primary),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  if (_linkedDocIds.isNotEmpty)
                    ..._linkedDocIds.map((lid) => _LinkedNoteChip(
                          noteId: lid,
                          onRemove: () => _removeLink(lid),
                        )),
                  _buildLinkSearchInput(theme),
                  const SizedBox(height: 16),

                  // ── 反向链接 ──
                  Row(
                    children: [
                      Text('反向链接', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: theme.colorScheme.onSurface)),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primary.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${_backlinks.length}',
                          style: TextStyle(fontSize: 10, color: theme.colorScheme.primary),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  if (_backlinks.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text(
                        '暂无其他笔记引用此文档',
                        style: TextStyle(fontSize: 12, color: theme.disabledColor),
                      ),
                    )
                  else
                    ..._backlinks.map((n) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  n.title ?? '无标题',
                                  style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Text(
                                n.date,
                                style: TextStyle(fontSize: 11, color: theme.disabledColor),
                              ),
                            ],
                          ),
                        )),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionLabel(ThemeData theme, String label) {
    return Text(
      label,
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: theme.colorScheme.onSurface,
      ),
    );
  }

  Widget _buildPathDisplay(ThemeData theme, String root, String rest) {
    final rootOption = pathRootOptions.where((o) => o.value == root).firstOrNull;
    return InkWell(
      onTap: _startEditPath,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: theme.dividerColor.withOpacity(0.5)),
        ),
        child: Row(
          children: [
            Text(
              rootOption?.label ?? '📂 $root',
              style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface),
            ),
            if (rest.isNotEmpty) ...[
              const SizedBox(width: 2),
              Text(
                '/ $rest',
                style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface),
              ),
            ],
            const Spacer(),
            Icon(Icons.edit, size: 12, color: theme.disabledColor),
          ],
        ),
      ),
    );
  }

  Widget _buildPathEditor(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: theme.colorScheme.primary.withOpacity(0.5)),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: DropdownButtonFormField<String>(
              value: _editRoot,
              isDense: true,
              decoration: const InputDecoration(
                isDense: true,
                contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              ),
              items: pathRootOptions.map((o) => DropdownMenuItem(
                value: o.value,
                child: Text(o.label, style: const TextStyle(fontSize: 12)),
              )).toList(),
              onChanged: (v) {
                if (v != null) setState(() => _editRoot = v);
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Text('/', style: TextStyle(color: theme.disabledColor)),
          ),
          Expanded(
            flex: 3,
            child: TextField(
              controller: TextEditingController(text: _editSub),
              style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface),
              decoration: InputDecoration(
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                hintText: '子路径...',
                hintStyle: TextStyle(fontSize: 12, color: theme.disabledColor),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(4),
                  borderSide: BorderSide(color: theme.dividerColor),
                ),
              ),
              onChanged: (v) => _editSub = v,
              onSubmitted: (_) => _handlePathChange(),
            ),
          ),
          const SizedBox(width: 4),
          InkWell(
            onTap: _handlePathChange,
            child: Icon(Icons.check, size: 16, color: theme.colorScheme.primary),
          ),
          const SizedBox(width: 4),
          InkWell(
            onTap: () => setState(() => _editingPath = false),
            child: Icon(Icons.close, size: 16, color: theme.disabledColor),
          ),
        ],
      ),
    );
  }

  Widget _buildTypeRadios(ThemeData theme) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: docTypeOptions.map((o) {
        final isSelected = _note.docType == o.value;
        return InkWell(
          onTap: () => _handleTypeChange(o.value),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              color: isSelected
                  ? theme.colorScheme.primary.withOpacity(0.15)
                  : null,
              border: Border.all(
                color: isSelected ? theme.colorScheme.primary : theme.dividerColor.withOpacity(0.5),
              ),
            ),
            child: Text(
              '${o.label.split(' ').length > 1 ? o.label : '${docTypeIcons[o.value] ?? ''} ${o.label}'}',
              style: TextStyle(
                fontSize: 12,
                color: isSelected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildConceptInput(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _conceptController,
          style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface),
          decoration: InputDecoration(
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            hintText: '添加概念...',
            hintStyle: TextStyle(fontSize: 12, color: theme.disabledColor),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(6),
              borderSide: BorderSide(color: theme.dividerColor),
            ),
          ),
          onChanged: _onConceptInput,
          onSubmitted: (v) => _addConcept(v),
        ),
        if (_suggestions.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 2),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: theme.dividerColor),
              color: theme.cardColor,
            ),
            constraints: const BoxConstraints(maxHeight: 120),
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              children: _suggestions.map((s) => InkWell(
                onTap: () => _addConcept(s),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  child: Text(s, style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface)),
                ),
              )).toList(),
            ),
          ),
      ],
    );
  }

  Widget _buildChip(ThemeData theme, String label, VoidCallback onRemove) {
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
            onTap: onRemove,
            child: Icon(Icons.close, size: 12, color: theme.colorScheme.primary),
          ),
        ],
      ),
    );
  }

  Widget _buildLinkSearchInput(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 4),
        TextField(
          controller: _linkSearchController,
          style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface),
          decoration: InputDecoration(
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            hintText: '搜索并关联文档...',
            hintStyle: TextStyle(fontSize: 12, color: theme.disabledColor),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(6),
              borderSide: BorderSide(color: theme.dividerColor),
            ),
          ),
          onChanged: _onLinkSearch,
        ),
        if (_linkResults.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 2),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: theme.dividerColor),
              color: theme.cardColor,
            ),
            constraints: const BoxConstraints(maxHeight: 150),
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              children: _linkResults.map((r) => InkWell(
                onTap: () => _addLink(r),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          r.title ?? '无标题',
                          style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        r.date,
                        style: TextStyle(fontSize: 11, color: theme.disabledColor),
                      ),
                    ],
                  ),
                ),
              )).toList(),
            ),
          ),
      ],
    );
  }
}

// ── 关联文档 Chip ──

class _LinkedNoteChip extends StatefulWidget {
  final String noteId;
  final VoidCallback onRemove;

  const _LinkedNoteChip({required this.noteId, required this.onRemove});

  @override
  State<_LinkedNoteChip> createState() => _LinkedNoteChipState();
}

class _LinkedNoteChipState extends State<_LinkedNoteChip> {
  Note? _note;

  @override
  void initState() {
    super.initState();
    _loadNote();
  }

  Future<void> _loadNote() async {
    final note = await context.read<NoteProvider>().loadNote(widget.noteId);
    if (mounted) setState(() => _note = note);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (_note == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 2),
        child: Text('...', style: TextStyle(fontSize: 12)),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _note!.title ?? '无标题',
              style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          InkWell(
            onTap: widget.onRemove,
            child: Icon(Icons.close, size: 14, color: theme.disabledColor),
          ),
        ],
      ),
    );
  }
}
