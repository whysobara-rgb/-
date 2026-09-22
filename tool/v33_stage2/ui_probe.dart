// Native UI evidence only: separate debug entrypoint, no live HTTP or purchases.
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/features/orders/batch_opening_page.dart';
import 'package:gacha_vault/features/inventory/presentation/inventory_page.dart';
import 'package:gacha_vault/features/profile/presentation/profile_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'fixtures.dart';

void main() {
  if (kReleaseMode) throw UnsupportedError('UI fixture is debug only');
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    debugPrint('V33_STAGE2_FAILED: ${details.exceptionAsString()}');
  };
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>(create: (_) => FixtureAuth()),
        ChangeNotifierProvider(create: (_) => GpProvider(initialBalance: 9900)),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: GachiTheme.data,
        home: const Stage2UiProbe(),
      ),
    ),
  );
}

class Stage2UiProbe extends StatefulWidget {
  const Stage2UiProbe({super.key});
  @override
  State<Stage2UiProbe> createState() => _Stage2UiProbeState();
}

class _Stage2UiProbeState extends State<Stage2UiProbe> {
  int _screen = 0;
  Timer? _timer;
  static const names = ['OPEN', 'RESULT', 'PARTIAL', 'COLLECTION', 'MY'];
  late final _screens = <Widget>[
    OrderFlowPage(userId: 10, repository: readOnlyRepository()),
    BatchOpeningPage(repository: readOnlyRepository(batch: batchFixture())),
    BatchOpeningPage(
      repository: readOnlyRepository(
        batch: batchFixture(completed: 1, total: 3, pending: true),
      ),
    ),
    InventoryPage(repository: FixtureInventory(inventoryFixtures())),
    ProfilePage(onGoToWallet: () {}),
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
        debugPrint('V33_STAGE2_${names[_screen]}_READY');
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
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
          Expanded(
            child: KeyedSubtree(
              key: ValueKey(_screen),
              child: _screens[_screen],
            ),
          ),
        ],
      ),
    ),
    bottomNavigationBar: _screen < 3
        ? null
        : GachiBottomNavigation(
            selectedIndex: _screen == 3 ? 3 : 4,
            onSelected: (_) {},
          ),
  );
}
