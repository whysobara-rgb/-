import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../wallet/presentation/widgets/gp_celebration.dart';
import '../../../shared/widgets/ui.dart';

/// 가입 직후 한 번: 가입 축하 GP가 들어왔음을 보여준다.
///
/// [welcomeGp]는 가입 응답의 값, 보유 GP는 방금 읽은 프로필 값이다.
class WelcomeGpPage extends StatelessWidget {
  final int welcomeGp;

  const WelcomeGpPage({super.key, required this.welcomeGp});

  static Route<void> route(int welcomeGp) => PageRouteBuilder<void>(
    settings: const RouteSettings(name: '/welcome'),
    fullscreenDialog: true,
    transitionDuration: const Duration(milliseconds: 320),
    pageBuilder: (_, _, _) => WelcomeGpPage(welcomeGp: welcomeGp),
    transitionsBuilder: (_, a, _, child) =>
        FadeTransition(opacity: a, child: child),
  );

  @override
  Widget build(BuildContext context) {
    final balance = context.watch<GpProvider>().balance;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x10,
            Space.gutter,
            Space.x4,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              GpCelebration(
                amount: welcomeGp,
                eyebrow: 'WELCOME BONUS',
                title: '가입을 축하해요',
              ),
              const SizedBox(height: Space.x8),
              SheetPanel(
                child: Column(
                  children: [
                    InfoRow(label: '가입 축하 GP', value: formatGp(welcomeGp)),
                    InfoRow(label: '지금 보유', value: formatGp(balance)),
                  ],
                ),
              ),
              const SizedBox(height: Space.x3),
              Text(
                'GP는 박스를 열거나 배송비를 낼 때 써요. 1 GP = 1원.',
                textAlign: TextAlign.center,
                style: AppText.caption,
              ),
              const Spacer(),
              PrimaryButton(
                label: '박스 보러 가기',
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
