import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;
import 'migrations.dart';

class DatabaseHelper {
  static final DatabaseHelper _instance = DatabaseHelper._();
  static DatabaseHelper get instance => _instance;
  DatabaseHelper._();

  Database? _database;
  Database get database => _database!;
  bool get isInitialized => _database != null;

  Future<void> initialize() async {
    if (_database != null) return;

    final dbPath = await getDatabasesPath();
    final path = p.join(dbPath, 'nine_rings.db');

    _database = await openDatabase(
      path,
      version: schemaVersion,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE IF NOT EXISTS _schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
          )
        ''');
        await db.execute(migrationV1);
        await db.insert('_schema_version', {
          'version': 1,
          'applied_at': DateTime.now().toUtc().toIso8601String(),
        });
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        final migrations = [
          (ver: 1, sql: migrationV1),
          (ver: 2, sql: migrationV2),
          (ver: 3, sql: migrationV3),
          (ver: 4, sql: migrationV4),
          (ver: 5, sql: migrationV5),
        ];

        for (final m in migrations) {
          if (m.ver > oldVersion && m.ver <= newVersion && m.sql.trim().isNotEmpty) {
            await db.execute(m.sql);
            await db.insert('_schema_version', {
              'version': m.ver,
              'applied_at': DateTime.now().toUtc().toIso8601String(),
            });
          }
        }
      },
    );
  }

  Future<void> close() async {
    await _database?.close();
    _database = null;
  }
}
