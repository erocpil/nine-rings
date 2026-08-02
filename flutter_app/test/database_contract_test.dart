import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nine_rings/database/database_helper.dart';
import 'package:nine_rings/database/migrations.dart';
import 'package:nine_rings/models/note.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

Future<Database> createDatabaseAt(int targetVersion) async {
  final db = await databaseFactoryFfi.openDatabase(inMemoryDatabasePath);
  await db.execute('''CREATE TABLE _schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )''');
  await DatabaseHelper.runMigrations(db, 0, targetVersion);
  return db;
}

void main() {
  setUpAll(() {
    sqfliteFfiInit();
  });

  for (final startingVersion in [0, 5]) {
    test('shared fixture behaves correctly from v$startingVersion', () async {
      final db = await createDatabaseAt(
        startingVersion == 0 ? schemaVersion : startingVersion,
      );
      if (startingVersion == 5) {
        await DatabaseHelper.runMigrations(db, 5, schemaVersion);
      }

      final fixture = jsonDecode(
        await File('../tests/fixtures/export-v1.json').readAsString(),
      ) as Map<String, dynamic>;
      final raw = fixture['notes'][1] as Map<String, dynamic>;
      final note = Note(
        id: '${raw['id']}-flutter-v$startingVersion',
        date: raw['date'] as String,
        title: raw['title'] as String?,
        content: jsonEncode(raw['content']),
        tags: List<String>.from(raw['tags'] as List),
        pinned: raw['pinned'] as bool,
        sortOrder: raw['sort_order'] as int,
        createdAt: raw['created_at'] as String,
        updatedAt: raw['updated_at'] as String,
        storagePath: raw['storagePath'] as String?,
        docType: raw['docType'] as String?,
        concepts: List<String>.from(raw['concepts'] as List),
        linkedDocIds: List<String>.from(raw['linkedDocIds'] as List),
        readonly: raw['readonly'] as bool,
      );
      final row = note.toJson()..['search_text'] = note.plainText;
      await db.insert('notes', row);

      expect(note.plainText, contains('Personal Access Token'));
      final stored = await db.query(
        'notes',
        where: 'id = ?',
        whereArgs: [note.id],
      );
      expect(stored.single['storage_path'], 'areas/nine-rings');

      final hits = await db.rawQuery(
        'SELECT COUNT(*) AS count FROM notes_fts WHERE notes_fts MATCH ?',
        ['Personal'],
      );
      expect(hits.single['count'], 1);

      await db.rawInsert(
        '''INSERT INTO note_versions
          (id, note_id, title, content, tags, pinned, sort_order, saved_at)
          SELECT ?, id, title, content, tags, pinned, sort_order, updated_at
          FROM notes WHERE id = ?''',
        ['fixture-version-$startingVersion', note.id],
      );
      expect(
        Sqflite.firstIntValue(
          await db.rawQuery(
            'SELECT COUNT(*) FROM note_versions WHERE note_id = ?',
            [note.id],
          ),
        ),
        1,
      );

      await db.update(
        'notes',
        {'deleted_at': '2026-08-02T00:00:00Z'},
        where: 'id = ?',
        whereArgs: [note.id],
      );
      expect(
        Sqflite.firstIntValue(
          await db.rawQuery(
            'SELECT COUNT(*) FROM notes WHERE id = ? AND deleted_at IS NULL',
            [note.id],
          ),
        ),
        0,
      );

      await db.close();
    });
  }
}
