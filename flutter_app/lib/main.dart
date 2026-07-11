import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'database/database_helper.dart';
import 'providers/note_provider.dart';
import 'screens/home_screen.dart';
import 'themes/app_theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await DatabaseHelper.instance.initialize();

  runApp(const NineRingsApp());
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
        themeMode: ThemeMode.light, // 显式指定，后续接入设置面板后改用用户选择
        home: const HomeScreen(),
      ),
    );
  }
}
