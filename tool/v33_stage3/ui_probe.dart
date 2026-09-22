// Separate debug-only native presentation probe. All HTTP uses MockClient.
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:gacha_vault/shared/widgets/gachi_flow.dart';
import 'fixtures.dart';

Future<void> main() async {
  if (kReleaseMode) throw UnsupportedError('UI fixture is debug only');
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    debugPrint('V33_STAGE3_FAILED: ${details.exceptionAsString()}');
  };
  final fixture = Stage3Fixture();
  await fixture.initialize();
  runApp(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: GachiTheme.data,
      home: Stage3UiProbe(fixture: fixture),
    ),
  );
}

class Stage3UiProbe extends StatefulWidget {
  final Stage3Fixture fixture;
  const Stage3UiProbe({super.key, required this.fixture});
  @override
  State<Stage3UiProbe> createState() => _Stage3UiProbeState();
}

class _Stage3UiProbeState extends State<Stage3UiProbe> {
  int _screen = 0;
  Timer? _timer;
  static const names = [
    'orders',
    'refund',
    'shipping',
    'security',
    'closure',
    'conversion',
  ];
  @override
  void initState() {
    super.initState();
    _announce();
  }

  void _announce() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _timer = Timer(const Duration(seconds: 3), () {
        if (!mounted) return;
        debugPrint('V33_STAGE3_${names[_screen].toUpperCase()}_READY');
        _timer = Timer(const Duration(seconds: 10), () {
          if (!mounted || _screen == names.length - 1) return;
          setState(() => _screen++);
          _announce();
        });
      });
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    widget.fixture.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MultiProvider(
    key: ValueKey(_screen),
    providers: [
      ChangeNotifierProvider<AuthProvider>.value(
        value: widget.fixture.authFor(names[_screen]),
      ),
      ChangeNotifierProvider(create: (_) => GpProvider(initialBalance: 1000)),
    ],
    child: Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Container(
              width: double.infinity,
              color: GachiColors.ivory,
              padding: const EdgeInsets.all(4),
              child: const Text(
                'UI 검증용 합성 데이터 · 실제 거래 없음',
                textAlign: TextAlign.center,
                style: GachiType.meta,
              ),
            ),
            Expanded(child: widget.fixture.page(names[_screen])),
          ],
        ),
      ),
    ),
  );
}
