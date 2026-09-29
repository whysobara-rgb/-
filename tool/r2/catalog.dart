// Review-only entry point. Never imported by lib/main.dart or supplied to CI builds.
// flutter run -d chrome -t tool/r2/catalog.dart
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/presentation/catalog_views.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'fixture.dart';

const photoUrls = [
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1000&q=85&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1727257048999-3582668ee135?w=1000&q=85&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1499961524705-bfd103e65a6d?w=1000&q=85&fit=crop&auto=format',
];

void main() {
  if (!kDebugMode) throw StateError('Review catalog is debug only');
  runApp(
    MaterialApp(theme: AppTheme.lightTheme, home: const R2ReviewCatalog()),
  );
}

class R2ReviewCatalog extends StatefulWidget {
  const R2ReviewCatalog({super.key});
  @override
  State<R2ReviewCatalog> createState() => _R2ReviewCatalogState();
}

class _R2ReviewCatalogState extends State<R2ReviewCatalog> {
  int index = 0;
  double scale = 1;
  bool photos = true;
  String action = '사진·박스·GP는 비거래 샘플입니다. 실서버 연결 없음.';
  void reviewAction(String label) =>
      setState(() => action = '$label 선택됨 · 이 카탈로그에서는 거래/계정 화면을 실행하지 않습니다.');
  @override
  Widget build(BuildContext context) {
    final boxes = List.generate(r2Boxes.length, (i) {
      final b = r2Boxes[i];
      return CapsuleBox(
        id: b.id,
        name: b.name,
        category: b.category,
        priceWon: b.priceWon,
        icon: b.icon,
        accentColor: b.accentColor,
        imageUrl: photos ? photoUrls[i] : null,
      );
    });
    return Scaffold(
      appBar: AppBar(title: const Text('R2-A · 실제 Flutter 위젯 · 비거래 검토')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 16,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              DropdownButton<double>(
                value: scale,
                items: [1.0, 2.0]
                    .map(
                      (s) => DropdownMenuItem(
                        value: s,
                        child: Text('글자 ${(s * 100).round()}%'),
                      ),
                    )
                    .toList(),
                onChanged: (s) => setState(() => scale = s!),
              ),
              FilterChip(
                label: const Text('검토용 사진'),
                selected: photos,
                onSelected: (s) => setState(() => photos = s),
              ),
            ],
          ),
          Text(action),
          const Text('사진은 Unsplash 허용 샘플. 실제 상품/당첨 결과가 아님. 홈·샵 이동과 필터만 로컬 동작.'),
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: 390,
              height: 844,
              child: MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  size: const Size(390, 844),
                  textScaler: TextScaler.linear(scale),
                  padding: const EdgeInsets.only(top: 44, bottom: 34),
                  viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
                ),
                child: Scaffold(
                  body: index == 0
                      ? HomeScreen(
                          boxes: boxes,
                          balance: '93,800',
                          onRefresh: () async {},
                          onOpen: (b) => reviewAction('${b.name} 구성'),
                          onWallet: () => reviewAction('GP'),
                          onShop: () => setState(() => index = 1),
                          onRanking: () => reviewAction('랭킹'),
                          onOpenUnopened: () => reviewAction('미개봉'),
                          onCollection: () => reviewAction('보관함'),
                          onUpdates: () => reviewAction('소식'),
                        )
                      : BoxShopScreen(
                          boxes: boxes,
                          balance: '93,800',
                          onRefresh: () async {},
                          onOpen: (b) => reviewAction('${b.name} 구성'),
                          onWallet: () => reviewAction('GP'),
                          onUpdates: () => reviewAction('소식'),
                        ),
                  bottomNavigationBar: GachiBottomNavigation(
                    selectedIndex: index,
                    onSelected: (i) {
                      if (i < 2) {
                        setState(() => index = i);
                      } else {
                        reviewAction(GachiBottomNavigation.labels[i]);
                      }
                    },
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
