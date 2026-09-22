import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:gacha_vault/core/config/app_config.dart';
import 'package:gacha_vault/navigation/main_navigation.dart';
import 'package:gacha_vault/features/ranking/presentation/ranking_screen.dart';
import 'package:gacha_vault/features/wallet/presentation/wallet_page.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/features/profile/presentation/profile_page.dart';
import 'package:gacha_vault/shared/models/app_user.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';

class NavigationAuth extends AuthProvider {
  @override
  AppUser get currentUser => const AppUser(
    id: 1,
    email: 'ui@example.invalid',
    nickname: 'UI 검증',
    coinBalance: 42,
  );
  @override
  Future<void> refreshProfile() async {}
}

void main() {
  testWidgets(
    'existing ranking/wallet routes remain reachable and opening obeys its gate',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>(
              create: (_) => NavigationAuth(),
            ),
            ChangeNotifierProvider(
              create: (_) => GpProvider(initialBalance: 42),
            ),
          ],
          child: MaterialApp(
            theme: GachiTheme.data,
            home: const MainNavigation(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('랭킹'));
      await tester.tap(find.text('랭킹'));
      await tester.pumpAndSettle();
      expect(find.byType(RankingScreen), findsOneWidget);
      Navigator.of(tester.element(find.byType(RankingScreen))).pop();
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('42 GP'));
      await tester.tap(find.text('42 GP'));
      await tester.pumpAndSettle();
      expect(find.byType(WalletPage), findsOneWidget);
      tester.widget<WalletPage>(find.byType(WalletPage)).onGoToHome();
      await tester.pumpAndSettle();
      expect(find.byType(WalletPage), findsNothing);
      await tester.tap(find.text('마이'));
      await tester.pumpAndSettle();
      tester.widget<ProfilePage>(find.byType(ProfilePage)).onGoToWallet();
      await tester.pumpAndSettle();
      expect(find.byType(WalletPage), findsOneWidget);
      Navigator.of(tester.element(find.byType(WalletPage))).pop();
      await tester.pumpAndSettle();
      await tester.tap(find.text('개봉'));
      // This test verifies routing. The existing recovery loader may remain active
      // without a configured native secure-store/API; transaction tests cover it separately.
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      if (AppConfig.orderPreviewEnabled) {
        final page = tester.widget<OrderFlowPage>(find.byType(OrderFlowPage));
        expect(page.userId, 1);
        expect(page.gachaId, isNull);
        expect(page.title, '미개봉 보관함');
      } else {
        expect(find.byType(OrderFlowPage), findsNothing);
        expect(find.text('현재 캡슐 구매 서비스를 준비하고 있습니다.'), findsOneWidget);
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
