import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:nine_rings/services/backup_protocol.dart';

void main() {
  final fixtures = jsonDecode(
    File('../schema/sync/fixtures/legacy-gates.json').readAsStringSync(),
  ) as List;
  for (final row in fixtures) {
    test('shared legacy gate: ${row['name']}', () {
      if (row['allowed'] == true) {
        expect(
          () => assertLegacyBackupProtocol(row['bundle']),
          returnsNormally,
        );
      } else {
        expect(
          () => assertLegacyBackupProtocol(row['bundle']),
          throwsStateError,
        );
      }
    });
  }
}
