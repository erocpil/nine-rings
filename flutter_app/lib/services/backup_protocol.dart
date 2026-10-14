/// Current releases support legacy exports only. Presence, even null, is not
/// permission to discard a newer protocol header through fixed storage models.
void assertLegacyBackupProtocol(Object? value) {
  if (value is! Map || value.containsKey('header')) {
    throw StateError('当前版本尚不支持此同步协议；本机数据未修改，不执行上传。');
  }
}
