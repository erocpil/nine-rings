import 'dart:convert';
import 'package:flutter/material.dart';
import '../models/note.dart';

class NoteCard extends StatelessWidget {
  final Note note;
  final VoidCallback? onTap;
  final VoidCallback? onPin;
  final VoidCallback? onDelete;
  final List<Widget>? actions;

  const NoteCard({
    super.key,
    required this.note,
    this.onTap,
    this.onPin,
    this.onDelete,
    this.actions,
  });

  String get _preview {
    try {
      final delta = jsonDecode(note.content);
      if (delta is! List) return '';
      return delta
          .where((op) => op is Map && op['insert'] is String)
          .map((op) => op['insert'] as String)
          .join()
          .trim()
          .replaceAll('\n', ' ');
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final preview = _preview;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header: title + actions
              Row(
                children: [
                  if (note.pinned)
                    Icon(Icons.push_pin, size: 16, color: theme.colorScheme.primary),
                  if (note.pinned) const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      note.title ?? '无标题',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: note.title != null ? FontWeight.w600 : FontWeight.normal,
                        color: note.title != null ? null : theme.disabledColor,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (actions != null) ...actions!,
                  if (onPin != null)
                    IconButton(
                      icon: Icon(
                        note.pinned ? Icons.push_pin : Icons.push_pin_outlined,
                        size: 18,
                      ),
                      onPressed: onPin,
                      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                      padding: EdgeInsets.zero,
                    ),
                  if (onDelete != null)
                    IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: onDelete,
                      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                      padding: EdgeInsets.zero,
                    ),
                ],
              ),

              // Tags
              if (note.tags.isNotEmpty) ...[
                const SizedBox(height: 4),
                Wrap(
                  spacing: 4,
                  runSpacing: 2,
                  children: note.tags.map((tag) {
                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.secondaryContainer,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        tag,
                        style: TextStyle(
                          fontSize: 11,
                          color: theme.colorScheme.onSecondaryContainer,
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],

              // Preview
              if (preview.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  preview,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.disabledColor,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
