import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/presentation/catalog_views.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import '../../tool/r2/fixture.dart';

const phase = String.fromEnvironment('R2_CAPTURE_PHASE', defaultValue: 'after');
const captureEnabled = bool.fromEnvironment('R2_CAPTURE');
void main() {
  if (!captureEnabled) return;
  setUpAll(() async {
    await (FontLoader('Pretendard')
          ..addFont(rootBundle.load('assets/fonts/Pretendard-Regular.otf'))
          ..addFont(rootBundle.load('assets/fonts/Pretendard-Bold.otf')))
        .load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  for (final scale in [1.0, 2.0]) {
    for (final screen in ['home', 'shop']) {
      testWidgets('R2 evidence $phase $screen 390 scale=$scale', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        for (var i = 0; i < r2Boxes.length; i++) {
          final file = ['sound', 'table', 'coffee'][i];
          await tester.runAsync(() async {
            final bytes = await File(
              'tool/r2/photos/$file-review.jpg',
            ).readAsBytes();
            final codec = await ui.instantiateImageCodec(bytes);
            final frame = await codec.getNextFrame();
            PaintingBinding.instance.imageCache.putIfAbsent(
              CachedNetworkImageProvider(r2Boxes[i].imageUrl!),
              () => OneFrameImageStreamCompleter(
                Future.value(ImageInfo(image: frame.image)),
              ),
            );
            codec.dispose();
          });
        }
        final page = screen == 'home'
            ? HomeScreen(
                boxes: r2Boxes,
                balance: '93,800',
                onRefresh: () async {},
                onOpen: (_) {},
                onWallet: () {},
                onShop: () {},
                onRanking: () {},
                onOpenUnopened: () {},
                onCollection: () {},
                onUpdates: () {},
              )
            : BoxShopScreen(
                boxes: r2Boxes,
                balance: '93,800',
                onRefresh: () async {},
                onOpen: (_) {},
                onWallet: () {},
                onUpdates: () {},
              );
        await tester.pumpWidget(
          MaterialApp(
            theme: AppTheme.lightTheme,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(scale),
                padding: const EdgeInsets.only(top: 44, bottom: 34),
                viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
              ),
              child: child!,
            ),
            home: RepaintBoundary(
              key: const Key('r2-screen'),
              child: Scaffold(
                body: page,
                bottomNavigationBar: GachiBottomNavigation(
                  selectedIndex: screen == 'home' ? 0 : 1,
                  onSelected: (_) {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final dir = Directory('build/r2-evidence/$phase')
          ..createSync(recursive: true);
        Future<void> capture(String name) async {
          final boundary = tester.renderObject<RenderRepaintBoundary>(
            find.byKey(const Key('r2-screen')),
          );
          await tester.runAsync(() async {
            final image = await boundary.toImage(pixelRatio: 1);
            final data = await image.toByteData(format: ui.ImageByteFormat.png);
            await File(
              '${dir.path}/$screen-${scale.toInt()}x-$name.png',
            ).writeAsBytes(data!.buffer.asUint8List());
            image.dispose();
          });
        }

        final scrollable = tester.state<ScrollableState>(
          find.byType(Scrollable).first,
        );
        final position = scrollable.position;
        await capture('first');
        // Sequential real viewports; no invented full-page layout or resized text.
        var n = 1;
        final offsets = <double>[0];
        while (position.pixels < position.maxScrollExtent) {
          position.jumpTo(
            (position.pixels + position.viewportDimension).clamp(
              0,
              position.maxScrollExtent,
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          offsets.add(position.pixels);
          await capture('page${++n}');
        }
        File(
          '${dir.path}/$screen-${scale.toInt()}x-metrics.json',
        ).writeAsStringSync(
          jsonEncode({
            'offsets': offsets,
            'width': 390,
            'height': 844,
            'textScale': scale,
            'viewport': position.viewportDimension,
            'maxScrollExtent': position.maxScrollExtent,
            'contentHeight':
                position.viewportDimension + position.maxScrollExtent,
            'data':
                'synthetic, non-transactional; identical before/after fixture',
            'rootTheme': 'AppTheme.lightTheme',
            'renderer': 'flutter_tester, not a device',
          }),
        );
      });
    }
  }
  if (phase == 'after') {
    for (final mode in ['missing', 'loading', 'error']) {
      testWidgets(
        'R2 hero $mode retains frame, name, price and detail action',
        (tester) async {
          tester.view.physicalSize = const Size(390, 844);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final pending = Completer<ImageInfo>();
          final url = mode == 'missing'
              ? null
              : 'https://review.invalid/$mode.jpg';
          if (url != null) {
            PaintingBinding.instance.imageCache.putIfAbsent(
              CachedNetworkImageProvider(url),
              () => OneFrameImageStreamCompleter(pending.future),
            );
          }
          final source = r2Boxes.first;
          final box = CapsuleBox(
            id: source.id,
            name: source.name,
            category: source.category,
            priceWon: source.priceWon,
            icon: source.icon,
            accentColor: source.accentColor,
            imageUrl: url,
          );
          var opened = 0;
          await tester.pumpWidget(
            MaterialApp(
              theme: AppTheme.lightTheme,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  padding: const EdgeInsets.only(top: 44, bottom: 34),
                  viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
                ),
                child: child!,
              ),
              home: RepaintBoundary(
                key: const Key('state-capture'),
                child: Scaffold(
                  body: HomeScreen(
                    boxes: [box],
                    balance: '93,800',
                    onRefresh: () async {},
                    onOpen: (_) => opened++,
                    onWallet: () {},
                    onShop: () {},
                    onRanking: () {},
                    onOpenUnopened: () {},
                    onCollection: () {},
                    onUpdates: () {},
                  ),
                  bottomNavigationBar: GachiBottomNavigation(
                    selectedIndex: 0,
                    onSelected: (_) {},
                  ),
                ),
              ),
            ),
          );
          await tester.pump(const Duration(milliseconds: 100));
          final before = tester.getRect(find.byType(GachiProductImage));
          if (mode == 'error') {
            pending.completeError(StateError('Synthetic review image failure'));
            await tester.pump();
            await tester.pump(const Duration(seconds: 1));
            expect(find.text('사진을 불러오지 못했어요'), findsOneWidget);
          }
          if (mode == 'missing') {
            expect(find.text('등록된 사진이 없어요'), findsOneWidget);
          }
          if (mode == 'loading') {
            expect(find.byType(CircularProgressIndicator), findsOneWidget);
          }
          expect(tester.getRect(find.byType(GachiProductImage)), before);
          expect(before.height, closeTo(350 / 1.5, .1));
          expect(find.text('1개 · 1,000 GP'), findsOneWidget);
          await tester.tap(find.text('구성·확률 보기'));
          expect(opened, 1);
          await tester.pump(const Duration(milliseconds: 300));
          expect(tester.takeException(), isNull);
          final boundary = tester.renderObject<RenderRepaintBoundary>(
            find.byKey(const Key('state-capture')),
          );
          await tester.runAsync(() async {
            final image = await boundary.toImage();
            final data = await image.toByteData(format: ui.ImageByteFormat.png);
            await File(
              'build/r2-evidence/after/home-photo-$mode.png',
            ).writeAsBytes(data!.buffer.asUint8List());
            image.dispose();
          });
          await tester.pumpWidget(const SizedBox());
          PaintingBinding.instance.imageCache.clear();
          PaintingBinding.instance.imageCache.clearLiveImages();
        },
      );
    }
  }
}
