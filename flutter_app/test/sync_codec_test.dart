import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nine_rings/database/database_helper.dart';
import 'package:nine_rings/database/migrations.dart';
import 'package:nine_rings/models/note.dart';
import 'package:nine_rings/services/sync_canonical_codec.dart';
import 'package:nine_rings/services/sync_strict_json.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  final parserCases =
      jsonDecode(
            File(
              '../schema/sync/fixtures/strict-json-v1.json',
            ).readAsStringSync(),
          )
          as List;
  for (var i = 0; i < parserCases.length; i++) {
    final row = parserCases[i];
    test('shared strict input $i', () {
      if (row['allowed'] == true) {
        expect(
          canonicalSyncJson(parseSyncJson(row['source'] as String)),
          canonicalSyncJson(jsonDecode(row['source'] as String)),
        );
      } else {
        expect(
          () => parseSyncJson(row['source'] as String),
          throwsFormatException,
        );
      }
    });
  }
  final vectors =
      jsonDecode(
            File(
              '../schema/sync/fixtures/canonical-v1.json',
            ).readAsStringSync(),
          )
          as Map;
  for (final row in vectors['vectors'] as List) {
    test('shared canonical vector: ${row['name']}', () {
      expect(canonicalSyncJson(row['input']), row['canonical']);
      expect(canonicalSyncDigest(row['input']), row['sha256']);
    });
  }
  test('rejects unsafe values and cycles', () {
    for (final value in [double.nan, double.infinity, 9007199254740992]) {
      expect(() => canonicalSyncJson(value), throwsFormatException);
    }
    final cycle = <Object?>[];
    cycle.add(cycle);
    expect(() => canonicalSyncJson(cycle), throwsFormatException);
    expect(() => canonicalSyncJson({1: 'bad key'}), throwsFormatException);
  });
  test(
    'storage model preserves object/string bodies and cross-platform aliases',
    () async {
      final fixture =
          jsonDecode(
                File(
                  '../schema/sync/fixtures/storage-roundtrip.json',
                ).readAsStringSync(),
              )
              as Map;
      final raw = Map<String, dynamic>.from(fixture['notes'][0] as Map);
      final camel = Map<String, dynamic>.from(raw);
      camel['storagePath'] = camel.remove('storage_path');
      camel['docType'] = camel.remove('doc_type');
      camel['linkedDocIds'] = camel.remove('linked_doc_ids');
      sqfliteFfiInit();
      final db = await databaseFactoryFfi.openDatabase(inMemoryDatabasePath);
      await db.execute(
        'CREATE TABLE _schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
      await DatabaseHelper.runMigrations(db, 0, schemaVersion);
      try {
        for (final source in [
          raw,
          camel,
          {...camel, 'content': jsonEncode(raw['content'])},
        ]) {
          final note = Note.fromJson(source);
          note.title = '改名后仍保留';
          await db.delete('notes');
          await db.insert('notes', {
            ...note.toJson(),
            'tags': jsonEncode(note.tags),
            'search_text': note.plainText,
          });
          final restored = Note.fromJson((await db.query('notes')).single);
          expect(restored.storagePath, 'references/sync');
          expect(restored.docType, 'reference');
          expect(restored.concepts, ['编码']);
          expect(restored.linkedDocIds, ['other-001']);
          expect(
            canonicalSyncDigest(jsonDecode(restored.content)),
            canonicalSyncDigest(raw['content']),
          );
          expect(restored.toJson().containsKey('futureRecord'), isFalse);
        }
      } finally {
        await db.close();
      }
    },
  );
}
