import 'dart:collection';
import 'dart:convert';

import 'package:crypto/crypto.dart';

/// Candidate codec 1. Kept separate from the legacy export/publish path.
String canonicalSyncJson(Object? value) {
  final ancestors = HashSet<Object>.identity();
  Never invalid() => throw const FormatException('不支持的同步 JSON 值');

  String encode(Object? input, int depth) {
    if (depth > 100) invalid();
    if (input == null) return 'null';
    if (input is String) return _quote(input);
    if (input is bool) return input ? 'true' : 'false';
    if (input is num) {
      if (!input.isFinite ||
          ((input is int || input == input.truncateToDouble()) &&
              input.abs() > 9007199254740991)) {
        invalid();
      }
      return _number(input);
    }
    if (input is! List && input is! Map) invalid();
    if (!ancestors.add(input)) invalid();
    try {
      if (input is List) {
        return '[${input.map((item) => encode(item, depth + 1)).join(',')}]';
      }
      final map = input as Map;
      if (map.keys.any((key) => key is! String)) invalid();
      final keys = map.keys.cast<String>().toList()..sort(_compareUtf16);
      return '{${keys.map((key) => '${_quote(key)}:${encode(map[key], depth + 1)}').join(',')}}';
    } finally {
      ancestors.remove(input);
    }
  }

  return encode(value, 0);
}

String canonicalSyncDigest(Object? value) =>
    sha256.convert(utf8.encode(canonicalSyncJson(value))).toString();

int _compareUtf16(String a, String b) {
  final size = a.length < b.length ? a.length : b.length;
  for (var i = 0; i < size; i++) {
    final difference = a.codeUnitAt(i) - b.codeUnitAt(i);
    if (difference != 0) return difference;
  }
  return a.length - b.length;
}

String _quote(String input) {
  final result = StringBuffer('"');
  const escapes = {
    8: r'\b',
    9: r'\t',
    10: r'\n',
    12: r'\f',
    13: r'\r',
    34: r'\"',
    92: r'\\',
  };
  for (var i = 0; i < input.length; i++) {
    final unit = input.codeUnitAt(i);
    final escape = escapes[unit];
    if (escape != null) {
      result.write(escape);
    } else if (unit < 32 ||
        (unit >= 0xd800 &&
            unit <= 0xdfff &&
            !(unit <= 0xdbff &&
                i + 1 < input.length &&
                input.codeUnitAt(i + 1) >= 0xdc00 &&
                input.codeUnitAt(i + 1) <= 0xdfff))) {
      result.write('\\u${unit.toRadixString(16).padLeft(4, '0')}');
    } else {
      result.writeCharCode(unit);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        result.writeCharCode(input.codeUnitAt(++i));
      }
    }
  }
  result.write('"');
  return result.toString();
}

// Normalize Dart's decimal/exponent layout to ECMAScript thresholds. Frozen
// vectors (including bit-pattern samples) certify supported runtime behavior.
String _number(num value) {
  if (value == 0) return '0';
  final negative = value < 0;
  final parts = value.abs().toString().toLowerCase().split('e');
  final mantissa = parts[0];
  var exponent = parts.length == 2 ? int.parse(parts[1]) : 0;
  final dot = mantissa.indexOf('.');
  exponent += (dot < 0 ? mantissa.length : dot) - 1;
  var digits = mantissa.replaceAll('.', '');
  while (digits.length > 1 && digits.startsWith('0')) {
    digits = digits.substring(1);
    exponent--;
  }
  while (digits.length > 1 && digits.endsWith('0')) {
    digits = digits.substring(0, digits.length - 1);
  }
  String result;
  if (exponent >= -6 && exponent < 21) {
    final decimal = exponent + 1;
    if (decimal <= 0) {
      result = '0.${'0' * -decimal}$digits';
    } else if (decimal >= digits.length) {
      result = '$digits${'0' * (decimal - digits.length)}';
    } else {
      result = '${digits.substring(0, decimal)}.${digits.substring(decimal)}';
    }
  } else {
    final tail = digits.length == 1 ? '' : '.${digits.substring(1)}';
    result = '${digits[0]}${tail}e${exponent >= 0 ? '+' : ''}$exponent';
  }
  return negative ? '-$result' : result;
}
