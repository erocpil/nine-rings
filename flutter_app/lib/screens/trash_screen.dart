import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../widgets/note_card.dart';

class TrashScreen extends StatelessWidget {
  const TrashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('回收站'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_sweep),
            tooltip: '清空回收站',
            onPressed: () async {
              final confirm = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('清空回收站'),
                  content: const Text('将永久删除回收站中超过30天的笔记？'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('清空', style: TextStyle(color: Colors.red)),
                    ),
                  ],
                ),
              );
              if (confirm == true) {
                if (!mounted) return;
                await context.read<NoteProvider>().emptyTrash();
              }
            },
          ),
        ],
      ),
      body: Consumer<NoteProvider>(
        builder: (context, provider, _) {
          final notes = provider.trashNotes;
          if (notes.isEmpty) {
            return const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.delete_outline, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text('回收站为空', style: TextStyle(color: Colors.grey)),
                ],
              ),
            );
          }
          return ListView.builder(
            itemCount: notes.length,
            itemBuilder: (ctx, i) {
              final note = notes[i];
              return NoteCard(
                note: note,
                onTap: () async {
                  await provider.restoreNote(note.id, note.date);
                },
                actions: [
                  TextButton(
                    onPressed: () => provider.restoreNote(note.id, note.date),
                    child: const Text('恢复'),
                  ),
                  TextButton(
                    onPressed: () async {
                      final confirm = await showDialog<bool>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('永久删除'),
                          content: const Text('此操作不可恢复。'),
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
                        await provider.permanentlyDelete(note.id);
                      }
                    },
                    child: const Text('永久删除', style: TextStyle(color: Colors.red)),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}
