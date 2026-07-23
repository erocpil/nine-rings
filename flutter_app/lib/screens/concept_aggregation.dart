import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../models/note.dart';
import '../widgets/doc_type_badge.dart';

/// 概念聚合页面 — 匹配 Tauri 概念面板设计
class ConceptAggregation extends StatefulWidget {
  const ConceptAggregation({super.key});

  @override
  State<ConceptAggregation> createState() => _ConceptAggregationState();
}

class _ConceptAggregationState extends State<ConceptAggregation> {
  String? _selectedConcept;
  List<Note> _matchingDocs = [];
  bool _loadingDocs = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<NoteProvider>().loadAllConcepts();
    });
  }

  Future<void> _selectConcept(String concept) async {
    setState(() {
      _selectedConcept = concept;
      _loadingDocs = true;
      _matchingDocs = [];
    });

    final provider = context.read<NoteProvider>();
    final docs = await provider.searchDocs(concept: concept);

    if (mounted) {
      setState(() {
        _matchingDocs = docs;
        _loadingDocs = false;
      });
    }
  }

  void _clearSelection() {
    setState(() {
      _selectedConcept = null;
      _matchingDocs = [];
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Consumer<NoteProvider>(
      builder: (context, provider, _) {
        final concepts = provider.allConcepts;

        return Scaffold(
          appBar: AppBar(
            title: const Text('概念聚合'),
            leading: _selectedConcept != null
                ? IconButton(
                    icon: const Icon(Icons.arrow_back),
                    onPressed: _clearSelection,
                  )
                : null,
          ),
          body: _selectedConcept != null
              ? _buildMatchingDocsView(theme, provider)
              : _buildConceptsView(theme, concepts, provider),
        );
      },
    );
  }

  Widget _buildConceptsView(ThemeData theme, List<String> concepts, NoteProvider provider) {
    if (concepts.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.label_outline, size: 48, color: theme.disabledColor),
            const SizedBox(height: 12),
            Text(
              '暂无概念标签',
              style: TextStyle(fontSize: 14, color: theme.disabledColor),
            ),
            const SizedBox(height: 4),
            Text(
              '在文档属性中添加概念标签后可在此聚合查看',
              style: TextStyle(fontSize: 12, color: theme.disabledColor),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () => provider.loadAllConcepts(),
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('刷新'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => provider.loadAllConcepts(),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 概念统计
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(8),
                color: theme.colorScheme.primary.withOpacity(0.05),
                border: Border.all(color: theme.dividerColor.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  Icon(Icons.label, size: 16, color: theme.colorScheme.primary),
                  const SizedBox(width: 8),
                  Text(
                    '共 ${concepts.length} 个概念',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '点击概念查看关联文档',
                    style: TextStyle(fontSize: 11, color: theme.disabledColor),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // 概念列表区
            Text(
              '全部概念',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: theme.colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: concepts.map((concept) {
                return InkWell(
                  onTap: () => _selectConcept(concept),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      color: theme.colorScheme.primary.withOpacity(0.08),
                      border: Border.all(
                        color: theme.colorScheme.primary.withOpacity(0.2),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '#',
                          style: TextStyle(
                            fontSize: 13,
                            color: theme.colorScheme.primary.withOpacity(0.6),
                          ),
                        ),
                        Text(
                          concept,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: theme.colorScheme.primary,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(
                          Icons.arrow_forward_ios,
                          size: 10,
                          color: theme.colorScheme.primary.withOpacity(0.4),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMatchingDocsView(ThemeData theme, NoteProvider provider) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 当前概念标题
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          color: theme.colorScheme.primary.withOpacity(0.05),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  color: theme.colorScheme.primary.withOpacity(0.12),
                ),
                child: Text(
                  '#$_selectedConcept',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: theme.colorScheme.primary,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                '${_matchingDocs.length} 篇文档',
                style: TextStyle(fontSize: 13, color: theme.disabledColor),
              ),
              const Spacer(),
              OutlinedButton.icon(
                onPressed: () => _selectConcept(_selectedConcept!),
                icon: const Icon(Icons.refresh, size: 14),
                label: const Text('刷新', style: TextStyle(fontSize: 12)),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  minimumSize: Size.zero,
                ),
              ),
            ],
          ),
        ),

        // 文档列表
        Expanded(
          child: _loadingDocs
              ? const Center(child: CircularProgressIndicator())
              : _matchingDocs.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.search_off, size: 40, color: theme.disabledColor),
                          const SizedBox(height: 10),
                          Text(
                            '没有找到标记为 #$_selectedConcept 的文档',
                            style: TextStyle(fontSize: 13, color: theme.disabledColor),
                          ),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: _matchingDocs.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final note = _matchingDocs[index];
                        return _DocResultCard(note: note);
                      },
                    ),
        ),
      ],
    );
  }
}

class _DocResultCard extends StatelessWidget {
  final Note note;

  const _DocResultCard({required this.note});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: EdgeInsets.zero,
      color: theme.cardColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: theme.dividerColor.withOpacity(0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                DocTypeBadge(docType: note.docType, readonly: note.readonly),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    note.title ?? '无标题',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onSurface,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            if (note.storagePath != null) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  Icon(Icons.folder_outlined, size: 12, color: theme.disabledColor),
                  const SizedBox(width: 4),
                  Text(
                    note.storagePath!,
                    style: TextStyle(fontSize: 11, color: theme.disabledColor),
                  ),
                  const Spacer(),
                  Text(
                    note.date,
                    style: TextStyle(fontSize: 11, color: theme.disabledColor),
                  ),
                ],
              ),
            ],
            if (note.concepts != null && note.concepts!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Wrap(
                spacing: 4,
                runSpacing: 2,
                children: note.concepts!.map((c) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(8),
                    color: theme.colorScheme.primary.withOpacity(0.08),
                  ),
                  child: Text(
                    '#$c',
                    style: TextStyle(fontSize: 10, color: theme.colorScheme.primary),
                  ),
                )).toList(),
              ),
            ],
            if (note.plainText.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                note.plainText.length > 100
                    ? '${note.plainText.substring(0, 100)}...'
                    : note.plainText,
                style: TextStyle(fontSize: 12, color: theme.disabledColor),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
