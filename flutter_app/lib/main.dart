import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'database/database_helper.dart';
import 'providers/note_provider.dart';
import 'screens/home_screen.dart';
import 'services/template_service.dart';
import 'themes/app_theme.dart';

void _log(String msg) {
  try {
    final logFile = File('${Directory.systemTemp.path}/nine-rings-startup.log');
    logFile.writeAsStringSync(
      '${DateTime.now().toIso8601String()} $msg\n',
      mode: FileMode.append,
    );
  } catch (_) {
    // ignore logging failures
  }
}

void main() async {
  _log('main() started');
  try {
    WidgetsFlutterBinding.ensureInitialized();
    _log('ensureInitialized done');

    sqfliteFfiInit();
    _log('sqfliteFfiInit done');

    await initializeDateFormatting();
    _log('initializeDateFormatting done');

    await DatabaseHelper.instance.initialize();
    _log('DatabaseHelper.initialize done');

    await TemplateService().seedBuiltinTemplates();
    _log('seedBuiltinTemplates done');

    runApp(const NineRingsApp());
    _log('runApp called');
  } catch (e, st) {
    _log('FATAL: $e\n$st');
    rethrow;
  }
}

class NineRingsApp extends StatelessWidget {
  const NineRingsApp({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = NineRingsTheme.all[NineRingsTheme.defaultId]!;

    return ChangeNotifierProvider(
      create: (_) => NoteProvider(),
      child: MaterialApp(
        title: 'Nine Rings',
        debugShowCheckedModeBanner: false,
        theme: theme.data,
        darkTheme: theme.data,
        themeMode: ThemeMode.light,
        home: const HomeScreen(),
      ),
    );
  }
}
