import 'package:flutter_test/flutter_test.dart';
import 'package:nine_rings/services/github_sync.dart';

void main() {
  test('stale device cannot replace a newer backup pointer', () {
    final config = SyncConfig(token: 'dummy', lastPullVersion: 'v1');
    expect(remoteBackupNeedsMerge(config, null), isFalse);
    expect(remoteBackupNeedsMerge(config, 'v1'), isFalse);
    expect(remoteBackupNeedsMerge(config, 'v2'), isTrue);
    config.lastPushVersion = 'v2';
    expect(remoteBackupNeedsMerge(config, 'v2'), isFalse);
  });
  test('credentials never appear in persisted configuration', () {
    final config = SyncConfig(token: 'dummy-secret', owner: 'owner');
    expect(config.toJson()['token'], '');
    expect(config.token, 'dummy-secret');
  });
}
