import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/note_provider.dart';
import '../widgets/note_card.dart';
import 'note_editor_screen.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _onSearch(String query) {
    context.read<NoteProvider>().search(query);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _searchController,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: '搜索笔记...',
            border: InputBorder.none,
          ),
          onChanged: _onSearch,
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.clear),
            onPressed: () {
              _searchController.clear();
              context.read<NoteProvider>().clearSearch();
            },
          ),
        ],
      ),
      body: Consumer<NoteProvider>(
        builder: (context, provider, _) {
          final results = provider.searchResults;
          if (results.isEmpty) {
            return const Center(
              child: Text('输入关键词开始搜索'),
            );
          }
          return ListView.builder(
            itemCount: results.length,
            itemBuilder: (ctx, i) {
              final note = results[i];
              return NoteCard(
                note: note,
                onTap: () async {
                  final changed = await Navigator.push<bool>(
                    context,
                    MaterialPageRoute(
                      builder: (_) => NoteEditorScreen(
                        date: note.date,
                        note: note,
                      ),
                    ),
                  );
                  if (changed == true) _onSearch(_searchController.text);
                },
                onDelete: () async {
                  await provider.deleteNote(note.id, note.date);
                  _onSearch(_searchController.text);
                },
              );
            },
          );
        },
      ),
    );
  }
}
