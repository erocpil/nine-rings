import 'dart:convert';
import 'package:uuid/uuid.dart';
import 'package:intl/intl.dart';
import 'package:sqflite/sqflite.dart';
import '../database/database_helper.dart';
import '../models/note.dart';
import '../models/note_version.dart';

const _uuid = Uuid();

class NoteService {
  final DatabaseHelper _db = DatabaseHelper.instance;

  // ── CRUD ──

  Future<List<Note>> getNotesByDate(String date) async {
    final rows = await _db.database.query(
      'notes',
      where: 'date = ? AND deleted_at IS NULL',
      whereArgs: [date],
      orderBy: 'pinned DESC, sort_order ASC, created_at ASC',
    );
    return rows.map((r) => Note.fromJson(r)).toList();
  }

  Future<List<String>> getRecentDates({int limit = 30}) async {
    final rows = await _db.database.rawQuery('''
      SELECT DISTINCT date FROM notes
      WHERE deleted_at IS NULL
      ORDER BY date DESC
      LIMIT ?
    ''', [limit]);
    return rows.map((r) => r['date'] as String).toList();
  }

  Future<Note> createNote({
    required String date,
    String? title,
    String? content,
    List<String>? tags,
    String? storagePath,
    String? docType,
    List<String>? concepts,
    List<String>? linkedDocIds,
    bool? readonly,
  }) async {
    final note = Note(
      date: date,
      title: title,
      content: content,
      tags: tags,
      storagePath: storagePath,
      docType: docType,
      concepts: concepts,
      linkedDocIds: linkedDocIds,
      readonly: readonly,
    );
    await _saveSnapshot(note, 'create');
    await _db.database.insert('notes', {
      ...note.toJson(),
      'search_text': note.plainText,
      'tags': jsonEncode(note.tags),
    });
    return note;
  }

  Future<Note> updateNote(Note note, {
    String? title,
    String? content,
    List<String>? tags,
    bool? pinned,
    int? sortOrder,
    String? storagePath,
    String? docType,
    List<String>? concepts,
    List<String>? linkedDocIds,
    bool? readonly,
  }) async {
    final updated = note.copyWith(
      title: title,
      content: content,
      tags: tags,
      pinned: pinned,
      sortOrder: sortOrder,
      storagePath: storagePath,
      docType: docType,
      concepts: concepts,
      linkedDocIds: linkedDocIds,
      readonly: readonly,
    );
    await _saveSnapshot(updated, 'update');
    await _db.database.update(
      'notes',
      {
        'title': updated.title,
        'content': updated.content,
        'tags': jsonEncode(updated.tags),
        'pinned': updated.pinned ? 1 : 0,
        'sort_order': updated.sortOrder,
        'search_text': updated.plainText,
        'updated_at': updated.updatedAt,
        'storage_path': updated.storagePath,
        'doc_type': updated.docType,
        'concepts': updated.concepts != null ? jsonEncode(updated.concepts) : null,
        'linked_doc_ids': updated.linkedDocIds != null ? jsonEncode(updated.linkedDocIds) : null,
        'readonly': updated.readonly ? 1 : 0,
      },
      where: 'id = ?',
      whereArgs: [note.id],
    );
    return updated;
  }

  Future<void> deleteNote(String id) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.database.update(
      'notes',
      {'deleted_at': now, 'updated_at': now},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> restoreNote(String id) async {
    await _db.database.update(
      'notes',
      {'deleted_at': null, 'updated_at': DateTime.now().toUtc().toIso8601String()},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> permanentlyDeleteNote(String id) async {
    await _db.database.delete('notes', where: 'id = ?', whereArgs: [id]);
    await _db.database.delete('note_versions', where: 'note_id = ?', whereArgs: [id]);
  }

  // ── Trash ──

  Future<List<Note>> getTrashNotes() async {
    final rows = await _db.database.query(
      'notes',
      where: 'deleted_at IS NOT NULL',
      orderBy: 'deleted_at DESC',
    );
    return rows.map((r) => Note.fromJson(r)).toList();
  }

  Future<void> emptyTrash({Duration olderThan = const Duration(days: 30)}) async {
    final cutoff = DateTime.now().subtract(olderThan).toUtc().toIso8601String();
    final ids = await _db.database.query(
      'notes',
      columns: ['id'],
      where: 'deleted_at IS NOT NULL AND deleted_at < ?',
      whereArgs: [cutoff],
    );
    for (final row in ids) {
      await permanentlyDeleteNote(row['id'] as String);
    }
  }

  // ── Search ──

  Future<List<Note>> search(String query) async {
    if (query.trim().isEmpty) return [];
    final like = '%${query.trim()}%';
    final rows = await _db.database.query(
      'notes',
      where: 'search_text LIKE ? AND deleted_at IS NULL',
      whereArgs: [like],
      orderBy: 'pinned DESC, updated_at DESC',
    );
    return rows.map((r) => Note.fromJson(r)).toList();
  }

  // ── Tags ──

  Future<List<String>> getAllTags() async {
    final rows = await _db.database.rawQuery('''
      SELECT DISTINCT tags FROM notes
      WHERE deleted_at IS NULL AND tags != '[]'
    ''');
    final tagSet = <String>{};
    for (final row in rows) {
      try {
        final list = jsonDecode(row['tags'] as String) as List;
        for (final t in list) {
          tagSet.add(t.toString());
        }
      } catch (_) {}
    }
    return tagSet.toList()..sort();
  }

  Future<List<Note>> getNotesByTag(String tag) async {
    final like = '%"$tag"%';
    final rows = await _db.database.query(
      'notes',
      where: 'tags LIKE ? AND deleted_at IS NULL',
      whereArgs: [like],
      orderBy: 'pinned DESC, sort_order ASC, updated_at DESC',
    );
    return rows.map((r) => Note.fromJson(r)).toList();
  }

  // ── Export / Import ──

  Future<String> exportAll() async {
    final notes = await _db.database.query(
      'notes',
      where: 'deleted_at IS NULL',
      orderBy: 'date DESC, sort_order ASC',
    );
    final dailyPages = await _db.database.query('daily_pages');
    final data = {
      'version': 1,
      'exported_at': DateTime.now().toUtc().toIso8601String(),
      'notes': notes.map((r) => Note.fromJson(r).toJson()).toList(),
      'daily_pages': dailyPages.map((r) {
        r['todos'] = jsonDecode(r['todos'] as String);
        return r;
      }).toList(),
    };
    return const JsonEncoder.withIndent('  ').convert(data);
  }

  Future<int> importBundle(String jsonStr) async {
    final data = jsonDecode(jsonStr) as Map;
    final notes = data['notes'] as List? ?? [];
    int count = 0;
    final batch = _db.database.batch();
    for (final n in notes) {
      final note = Note.fromJson(n as Map<String, dynamic>);
      batch.insert('notes', {
        ...note.toJson(),
        'search_text': note.plainText,
        'sort_order': note.sortOrder,
        'tags': jsonEncode(note.tags),
      }, conflictAlgorithm: ConflictAlgorithm.replace);
      count++;
    }
    await batch.commit(noResult: true);
    return count;
  }

  // ── Version History ──

  Future<void> _saveSnapshot(Note note, String action) async {
    if (action == 'create') return; // no snapshot for new notes
    final version = NoteVersion(
      id: _uuid.v4(),
      noteId: note.id,
      title: note.title ?? '',
      content: note.content,
      tags: List.from(note.tags),
      order: note.sortOrder,
      createdAt: DateTime.now().toUtc().toIso8601String(),
    );
    // Limit: keep last 30 versions per note
    final count = Sqflite.firstIntValue(await _db.database.rawQuery(
      'SELECT COUNT(*) FROM note_versions WHERE note_id = ?',
      [note.id],
    )) ?? 0;
    if (count >= 30) {
      await _db.database.rawDelete(
        'DELETE FROM note_versions WHERE id IN ('
        'SELECT id FROM note_versions WHERE note_id = ? ORDER BY created_at ASC LIMIT ?'
        ')',
        [note.id, count - 29],
      );
    }
    await _db.database.insert('note_versions', version.toJson());
  }

  Future<List<NoteVersion>> getVersions(String noteId) async {
    final rows = await _db.database.query(
      'note_versions',
      where: 'note_id = ?',
      whereArgs: [noteId],
      orderBy: 'created_at DESC',
    );
    return rows.map((r) => NoteVersion.fromJson(r)).toList();
  }

  Future<Note?> restoreVersion(String noteId, String versionId) async {
    final rows = await _db.database.query(
      'note_versions',
      where: 'id = ? AND note_id = ?',
      whereArgs: [versionId, noteId],
    );
    if (rows.isEmpty) return null;
    final version = NoteVersion.fromJson(rows.first);
    final noteRows = await _db.database.query(
      'notes',
      where: 'id = ?',
      whereArgs: [noteId],
    );
    if (noteRows.isEmpty) return null;
    final current = Note.fromJson(noteRows.first);
    // Save current state as a version before overwriting
    await _saveSnapshot(current, 'update');
    // Restore version's data
    final restored = current.copyWith(
      title: version.title.isEmpty ? null : version.title,
      content: version.content,
      tags: version.tags,
      sortOrder: version.order,
    );
    await _db.database.update(
      'notes',
      {
        'title': restored.title,
        'content': restored.content,
        'tags': jsonEncode(restored.tags),
        'sort_order': restored.sortOrder,
        'search_text': restored.plainText,
        'updated_at': restored.updatedAt,
      },
      where: 'id = ?',
      whereArgs: [noteId],
    );
    return restored;
  }

  // ── Daily Page ──

  Future<Map<String, dynamic>> getOrCreateDailyPage(String date) async {
    // Get or create daily page (notes fetched separately)
    var page = await _db.database.query(
      'daily_pages',
      where: 'date = ?',
      whereArgs: [date],
    );

    if (page.isEmpty) {
      final yesterday = DateFormat('yyyy-MM-dd').format(
        DateTime.parse(date).subtract(const Duration(days: 1)),
      );
      // Try carryover from yesterday
      final yesterdayPage = await _db.database.query(
        'daily_pages',
        where: 'date = ? AND todo_carryover = 1',
        whereArgs: [yesterday],
      );
      List<dynamic> carryoverTodos = [];
      if (yesterdayPage.isNotEmpty) {
        final allTodos = jsonDecode(yesterdayPage.first['todos'] as String) as List;
        carryoverTodos = allTodos
            .where((t) => (t['done'] == 0 || t['done'] == false))
            .map((t) => {
                  ...t as Map,
                  'id': _uuid.v4(),
                })
            .toList();
      }

      await _db.database.insert('daily_pages', {
        'date': date,
        'todos': jsonEncode(carryoverTodos),
        'todo_carryover': 0,
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      });

      return {
        'date': date,
        'todos': carryoverTodos,
        'todo_carryover': false,
      };
    }

    final row = page.first;
    return {
      'date': row['date'],
      'todos': row['todos'] != null ? jsonDecode(row['todos'] as String) : [],
      'todo_carryover': row['todo_carryover'] == 1,
    };
  }

  Future<void> updateDailyPageTodos(String date, List<dynamic> todos) async {
    await _db.database.update(
      'daily_pages',
      {
        'todos': jsonEncode(todos),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
      where: 'date = ?',
      whereArgs: [date],
    );
  }

  Future<void> setTodoCarryover(String date, bool enabled) async {
    await _db.database.update(
      'daily_pages',
      {
        'todo_carryover': enabled ? 1 : 0,
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
      where: 'date = ?',
      whereArgs: [date],
    );
  }

  // ── Markdown export (Delta → Markdown) ──

  String deltaToMarkdown(String deltaJson) {
    try {
      final ops = jsonDecode(deltaJson);
      if (ops is! List) return '';
      final buf = StringBuffer();
      for (final op in ops) {
        if (op is! Map) continue;
        final insert = op['insert'];
        if (insert is! String) continue;
        final attrs = op['attributes'] as Map? ?? {};
        String text = insert;
        // Handle newlines
        if (text == '\n') continue;

        if (attrs['bold'] == true) text = '**$text**';
        if (attrs['italic'] == true) text = '*$text*';
        if (attrs['strike'] == true) text = '~~$text~~';
        if (attrs['code'] == true) text = '`$text`';
        if (attrs['link'] is String) text = '[$text](${attrs['link']})';
        if (attrs['header'] == 1) text = '# $text\n';
        if (attrs['header'] == 2) text = '## $text\n';
        if (attrs['header'] == 3) text = '### $text\n';
        if (attrs['list'] == 'bullet') text = '- $text\n';
        if (attrs['list'] == 'ordered') text = '1. $text\n';
        if (attrs['blockquote'] == true) text = '> $text\n';
        if (attrs['code-block'] == true) text = '```\n$text\n```\n';

        buf.write(text);
      }
      return buf.toString().trim();
    } catch (_) {
      return deltaJson; // fallback: return raw
    }
  }
}
