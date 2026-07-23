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

  // ── FTS5 Full-Text Search ──

  Future<List<Note>> ftsSearch(String query) async {
    if (query.trim().isEmpty) return [];
    try {
      final rows = await _db.database.rawQuery('''
        SELECT n.* FROM notes n
        JOIN notes_fts fts ON n.rowid = fts.rowid
        WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
        ORDER BY rank
      ''', [query.trim()]);
      return rows.map((r) => Note.fromJson(r)).toList();
    } catch (_) {
      // FTS5 fallback: 使用 LIKE 搜索
      return search(query);
    }
  }

  // ── Document queries ──

  Future<List<Note>> getNotesByPath(String pathPrefix) async {
    final rows = await _db.database.query(
      'notes',
      where: 'storage_path LIKE ? AND deleted_at IS NULL',
      whereArgs: ['$pathPrefix%'],
      orderBy: 'storage_path ASC, sort_order ASC',
    );
    return rows.map((r) => Note.fromJson(r)).toList();
  }

  Future<List<Note>> searchDocs({
    String? text,
    String? storagePath,
    String? docType,
    String? concept,
  }) async {
    final conditions = <String>['storage_path IS NOT NULL', 'deleted_at IS NULL'];
    final args = <dynamic>[];

    if (text != null && text.isNotEmpty) {
      conditions.add('search_text LIKE ?');
      args.add('%$text%');
    }
    if (storagePath != null && storagePath.isNotEmpty) {
      conditions.add('storage_path LIKE ?');
      args.add('$storagePath%');
    }
    if (docType != null && docType.isNotEmpty) {
      conditions.add('doc_type = ?');
      args.add(docType);
    }
    if (concept != null && concept.isNotEmpty) {
      conditions.add('concepts LIKE ?');
      args.add('%"$concept"%');
    }

    final where = conditions.join(' AND ');
    final rows = await _db.database.query(
      'notes',
      where: where,
      whereArgs: args,
      orderBy: 'updated_at DESC',
    );
    return rows.map((r) => Note.fromJson(r)).toList();
  }

  Future<List<String>> getAllConcepts() async {
    final rows = await _db.database.rawQuery('''
      SELECT DISTINCT concepts FROM notes
      WHERE deleted_at IS NULL AND concepts IS NOT NULL AND concepts != '[]'
    ''');
    final conceptSet = <String>{};
    for (final row in rows) {
      try {
        final list = jsonDecode(row['concepts'] as String) as List;
        for (final c in list) {
          conceptSet.add(c.toString());
        }
      } catch (_) {}
    }
    return conceptSet.toList()..sort();
  }

  Future<Map<String, List<Note>>> getPathTree() async {
    final rows = await _db.database.query(
      'notes',
      where: 'storage_path IS NOT NULL AND deleted_at IS NULL',
      orderBy: 'storage_path ASC, sort_order ASC',
    );
    final notes = rows.map((r) => Note.fromJson(r)).toList();
    final tree = <String, List<Note>>{};
    for (final note in notes) {
      if (note.storagePath == null) continue;
      final parts = note.storagePath!.split('/');
      // Group by parent path
      if (parts.length > 1) {
        final parent = parts.sublist(0, parts.length - 1).join('/');
        tree.putIfAbsent(parent, () => []).add(note);
      } else {
        tree.putIfAbsent(note.storagePath!, () => []).add(note);
      }
    }
    return tree;
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

  /// 从 JSON 字符串导入全量数据。返回 (notesImported, pagesImported)。
  /// 与 Web 端 importData 语义对齐。
  Future<({int notesImported, int pagesImported})> importBundle(String jsonStr) async {
    final data = jsonDecode(jsonStr) as Map;
    final notes = data['notes'] as List? ?? [];
    final dailyPages = data['daily_pages'] as List? ?? [];

    int notesCount = 0;
    int pagesCount = 0;

    final batch = _db.database.batch();

    // ── 导入笔记 ──
    for (final n in notes) {
      final note = Note.fromJson(n as Map<String, dynamic>);
      batch.insert('notes', {
        ...note.toJson(),
        'search_text': note.plainText,
        'sort_order': note.sortOrder,
        'tags': jsonEncode(note.tags),
      }, conflictAlgorithm: ConflictAlgorithm.replace);
      notesCount++;
    }

    // ── 导入每日页面 ──
    for (final p in dailyPages) {
      final page = p as Map<String, dynamic>;
      final date = page['date'] as String?;
      if (date == null) continue;
      // 使用 replace 策略：先删后插
      batch.delete('daily_pages', where: 'date = ?', whereArgs: [date]);
      batch.insert('daily_pages', {
        'date': date,
        'todos': page['todos'] is String
            ? page['todos']
            : jsonEncode(page['todos'] ?? []),
        'todo_carryover': page['todo_carryover'] ?? false,
      });
      pagesCount++;
    }

    await batch.commit(noResult: true);
    return (notesImported: notesCount, pagesImported: pagesCount);
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

  // ── Single note fetch ──

  Future<Note?> getNoteById(String id) async {
    final rows = await _db.database.query(
      'notes',
      where: 'id = ?',
      whereArgs: [id],
    );
    if (rows.isEmpty) return null;
    return Note.fromJson(rows.first);
  }

  // ── Backlinks ──

  Future<List<Note>> getBacklinks(String noteId) async {
    final like = '%\"$noteId\"%';
    final rows = await _db.database.query(
      'notes',
      where: 'linked_doc_ids LIKE ? AND deleted_at IS NULL',
      whereArgs: [like],
      orderBy: 'updated_at DESC',
    );
    return rows.map((r) => Note.fromJson(r)).toList();
  }

  // ── Folder operations ──

  Future<int> renameFolder(String oldPath, String newPath) async {
    final db = _db.database;
    // Find all notes under oldPath
    final rows = await db.query(
      'notes',
      columns: ['id', 'storage_path'],
      where: 'storage_path LIKE ? AND deleted_at IS NULL',
      whereArgs: ['$oldPath%'],
    );
    int count = 0;
    final now = DateTime.now().toUtc().toIso8601String();
    for (final row in rows) {
      final currentPath = row['storage_path'] as String?;
      if (currentPath == null) continue;
      // Replace oldPath prefix with newPath
      final updatedPath = currentPath.replaceFirst(oldPath, newPath);
      await db.update(
        'notes',
        {'storage_path': updatedPath, 'updated_at': now},
        where: 'id = ?',
        whereArgs: [row['id']],
      );
      count++;
    }
    // Also handle sub-folders: notes that have storage_path exactly matching oldPath
    // (already covered by LIKE above, but ensure exact match too)
    final exactRows = await db.query(
      'notes',
      columns: ['id'],
      where: 'storage_path = ? AND deleted_at IS NULL',
      whereArgs: [oldPath],
    );
    for (final row in exactRows) {
      final id = row['id'] as String;
      await db.update(
        'notes',
        {'storage_path': newPath, 'updated_at': now},
        where: 'id = ?',
        whereArgs: [id],
      );
      count++;
    }
    return count;
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

  // ── Markdown import (Markdown → Delta JSON) ──

  /// 将 Markdown 文本转为 Quill Delta JSON 字符串。
  /// 与 Web 端 md-parser.ts 实现对齐。
  String mdToDelta(String mdText) {
    final ops = _mdToDeltaOps(mdText);
    return jsonEncode({'ops': ops});
  }

  /// 从 Markdown 提取第一个 # 标题，fallback 到文件名。
  String extractTitle(String mdText, String fallback) {
    final m = RegExp(r'^#\s+(.+)$', multiLine: true).firstMatch(mdText);
    return m != null ? m.group(1)!.trim() : fallback;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Markdown → Delta 内部实现（与 Web 端 md-parser.ts 对齐）
// ═══════════════════════════════════════════════════════════════════

/// 行内解析：**粗体** *斜体* `行内代码` [链接](url)
List<Map<String, dynamic>> _parseInline(String text) {
  final result = <Map<String, dynamic>>[];
  int i = 0;

  while (i < text.length) {
    // [链接](url)
    final linkMatch = RegExp(r'^\[([^\]]+)\]\(([^)]+)\)').matchAsPrefix(text, i);
    if (linkMatch != null) {
      result.add({'text': linkMatch.group(1)!, 'attrs': {'link': linkMatch.group(2)!}});
      i = linkMatch.end;
      continue;
    }

    // **粗体**
    if (i + 1 < text.length && text[i] == '*' && text[i + 1] == '*') {
      final j = text.indexOf('**', i + 2);
      if (j != -1) {
        result.add({'text': text.substring(i + 2, j), 'attrs': {'bold': true}});
        i = j + 2;
        continue;
      }
    }

    // *斜体*（单星号）
    if (text[i] == '*' && (i + 1 >= text.length || text[i + 1] != '*')) {
      final j = text.indexOf('*', i + 1);
      if (j != -1) {
        final inner = text.substring(i + 1, j);
        if (inner.isNotEmpty) {
          result.add({'text': inner, 'attrs': {'italic': true}});
          i = j + 1;
          continue;
        }
      }
    }

    // `行内代码`
    if (text[i] == '`') {
      final j = text.indexOf('`', i + 1);
      if (j != -1) {
        result.add({'text': text.substring(i + 1, j), 'attrs': {'code': true}});
        i = j + 1;
        continue;
      }
    }

    // 普通字符
    result.add({'text': text[i], 'attrs': <String, dynamic>{}});
    i++;
  }

  return result;
}

List<Map<String, dynamic>> _inlineToDelta(
  String text, {
  Map<String, dynamic>? baseAttrs,
}) {
  if (text.isEmpty) return [];

  final segments = _parseInline(text);
  final merged = <Map<String, dynamic>>[];

  for (final seg in segments) {
    final combined = <String, dynamic>{...(baseAttrs ?? {})};
    for (final entry in (seg['attrs'] as Map).entries) {
      if (entry.value != null && entry.value != false && entry.value != '') {
        combined[entry.key as String] = entry.value;
      }
    }

    final last = merged.isNotEmpty ? merged.last : null;
    if (last != null && _mapsEqual(last['attrs'] as Map, combined)) {
      last['text'] = last['text'].toString() + (seg['text'] as String);
    } else {
      merged.add({'text': seg['text'], 'attrs': combined});
    }
  }

  return merged.map((m) {
    final op = <String, dynamic>{'insert': m['text']};
    if ((m['attrs'] as Map).isNotEmpty) op['attributes'] = m['attrs'];
    return op;
  }).toList();
}

bool _mapsEqual(Map a, Map b) {
  if (a.length != b.length) return false;
  for (final key in a.keys) {
    if (b[key] != a[key]) return false;
  }
  return true;
}

List<Map<String, dynamic>> _mdToDeltaOps(String mdText) {
  final lines = mdText.split('\n');
  final ops = <Map<String, dynamic>>[];
  int i = 0;
  bool inCode = false;
  final codeBuf = <String>[];

  while (i < lines.length) {
    final line = lines[i];
    final stripped = line.trim();

    // ── 代码块 ──
    if (RegExp(r'^```').hasMatch(stripped)) {
      if (inCode) {
        if (codeBuf.isNotEmpty) {
          ops.add({'insert': codeBuf.join('\n')});
          ops.add({'insert': '\n', 'attributes': {'code-block': true}});
        }
        codeBuf.clear();
        inCode = false;
      } else {
        inCode = true;
      }
      i++;
      continue;
    }

    if (inCode) {
      codeBuf.add(line);
      i++;
      continue;
    }

    // ── 空行 ──
    if (stripped.isEmpty) {
      if (ops.isNotEmpty && !(ops.last['insert'] as String).endsWith('\n')) {
        ops.add({'insert': '\n'});
      }
      i++;
      continue;
    }

    // ── 分割线 ──
    if (RegExp(r'^[-*_]{3,}\s*$').hasMatch(stripped)) {
      ops.add({'insert': '─' * 8, 'attributes': {'strike': true}});
      ops.add({'insert': '\n'});
      i++;
      continue;
    }

    // ── 标题 ──
    final hMatch = RegExp(r'^(#{1,6})\s+(.+)$').firstMatch(stripped);
    if (hMatch != null) {
      final level = hMatch.group(1)!.length;
      final text = hMatch.group(2)!;
      ops.addAll(_inlineToDelta(text));
      ops.add({'insert': '\n', 'attributes': {'header': level}});
      i++;
      continue;
    }

    // ── 引用 ──
    final bqMatch = RegExp(r'^>\s?(.*)$').firstMatch(stripped);
    if (bqMatch != null) {
      ops.addAll(_inlineToDelta(bqMatch.group(1)!));
      ops.add({'insert': '\n', 'attributes': {'blockquote': true}});
      i++;
      continue;
    }

    // ── 无序列表 ──
    final blMatch = RegExp(r'^[-*+]\s+(.+)$').firstMatch(stripped);
    if (blMatch != null) {
      ops.addAll(_inlineToDelta(blMatch.group(1)!));
      ops.add({'insert': '\n', 'attributes': {'list': 'bullet'}});
      i++;
      continue;
    }

    // ── 有序列表 ──
    final olMatch = RegExp(r'^\d+\.\s+(.+)$').firstMatch(stripped);
    if (olMatch != null) {
      ops.addAll(_inlineToDelta(olMatch.group(1)!));
      ops.add({'insert': '\n', 'attributes': {'list': 'ordered'}});
      i++;
      continue;
    }

    // ── 普通段落 ──
    ops.addAll(_inlineToDelta(line));
    ops.add({'insert': '\n'});
    i++;
  }

  // 关闭未闭合的代码块
  if (inCode && codeBuf.isNotEmpty) {
    ops.add({'insert': codeBuf.join('\n')});
    ops.add({'insert': '\n', 'attributes': {'code-block': true}});
  }

  return ops;
}
