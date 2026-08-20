import 'package:flutter/material.dart';
import '../../../shared/widgets/coming_soon_view.dart';
import '../../../shared/widgets/gp_badge.dart';

/// 가챠 탭 화면 (더미).
class GachaScreen extends StatelessWidget {
  const GachaScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('가챠'), actions: const [GpBadge()]),
      body: const ComingSoonView(
        title: '가챠',
        icon: Icons.card_giftcard_rounded,
      ),
    );
  }
}
