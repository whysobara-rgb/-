import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/home/presentation/catalog_views.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'r2_catalog_test.dart' show r2Boxes;
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/presentation/widgets/capsule_box_card.dart';

const captureEnabled = bool.fromEnvironment('R2_A1_CAPTURE');
const evidencePhase = String.fromEnvironment(
  'R2_A1_PHASE',
  defaultValue: 'after',
);
const sorts = ['기본순', '낮은 가격순', '높은 가격순'];

Future<void> mount(WidgetTester t, Widget screen, {double scale = 1}) async {
  t.view.physicalSize = const Size(390, 844);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  addTearDown(t.view.resetDevicePixelRatio);
  await t.pumpWidget(
    MaterialApp(
      theme: AppTheme.lightTheme,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          padding: const EdgeInsets.only(top: 44, bottom: 34),
          viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
        ),
        child: RepaintBoundary(key: const Key('a1-capture'), child: child!),
      ),
      home: Scaffold(
        body: screen,
        bottomNavigationBar: GachiBottomNavigation(
          selectedIndex: screen is HomeScreen ? 0 : 1,
          onSelected: (_) {},
        ),
      ),
    ),
  );
  await t.pump(const Duration(milliseconds: 400));
}

Future<void> capture(WidgetTester t, String name, [Object? metrics]) async {
  if (!captureEnabled) return;
  final dir = Directory('build/r2-a1-evidence/$evidencePhase')
    ..createSync(recursive: true);
  final boundary = t.renderObject<RenderRepaintBoundary>(
    find.byKey(const Key('a1-capture')),
  );
  await t.runAsync(() async {
    final image = await boundary.toImage();
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    await File(
      '${dir.path}/$name.png',
    ).writeAsBytes(data!.buffer.asUint8List());
    image.dispose();
  });
  if (metrics != null) {
    File(
      '${dir.path}/$name.json',
    ).writeAsStringSync(const JsonEncoder.withIndent('  ').convert(metrics));
  }
}

double contrast(Color a, Color b) {
  final values = [a.computeLuminance(), b.computeLuminance()]..sort();
  return (values.last + .05) / (values.first + .05);
}

String hex(Color c) => c.toARGB32().toRadixString(16);

// Flutter 3.35.4 rendered Ink/paragraph and the checkmark painter's resolved
// theme, not only the ChoiceChip constructor or an inferred ColorScheme.
Map<String, dynamic> effectiveChip(WidgetTester t, String label) {
  final chip = find.ancestor(
    of: find.text(label),
    matching: find.byType(ChoiceChip),
  );
  final ink = t.widget<Ink>(
    find.descendant(of: chip, matching: find.byType(Ink)).first,
  );
  final background = (ink.decoration! as ShapeDecoration).color!;
  final text = t
      .renderObject<RenderParagraph>(find.text(label))
      .text
      .style!
      .color!;
  final renderWidget = find.descendant(
    of: chip,
    matching: find.byWidgetPredicate(
      (w) => w.runtimeType.toString() == '_ChipRenderWidget',
    ),
  );
  final dynamic renderer = t.renderObject(renderWidget);
  final Color checkmark = renderer.theme.checkmarkColor as Color;
  return {
    'label': label,
    'selected': t.widget<ChoiceChip>(chip).selected,
    'background': hex(background),
    'text': hex(text),
    'checkmark': hex(checkmark),
    'textContrast': contrast(text, background),
    'checkmarkContrast': contrast(checkmark, background),
    'showCheckmark': renderer.theme.showCheckmark,
  };
}

void main() {
  if (captureEnabled) {
    setUpAll(() async {
      await (FontLoader('Pretendard')
            ..addFont(rootBundle.load('assets/fonts/Pretendard-Regular.otf'))
            ..addFont(rootBundle.load('assets/fonts/Pretendard-Bold.otf')))
          .load();
      await (FontLoader(
        'MaterialIcons',
      )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
    });
  }
  for (final scale in [1.0, 2.0]) {
    for (final selected in sorts) {
      testWidgets(
        'AppTheme shop selected sort $selected scale=$scale has readable effective contrast',
        (t) async {
          await mount(
            t,
            BoxShopScreen(
              boxes: r2Boxes,
              balance: '93,800',
              onRefresh: () async {},
              onOpen: (_) {},
              onWallet: () {},
            ),
            scale: scale,
          );
          await t.tap(find.byKey(const Key('catalog-filter')));
          await t.pumpAndSettle();
          await t.ensureVisible(find.text(selected));
          await t.pumpAndSettle();
          await t.tap(find.text(selected));
          await t.pumpAndSettle();
          for (final label in sorts) {
            final chip = find.ancestor(
              of: find.text(label),
              matching: find.byType(ChoiceChip),
            );
            expect(
              t.getSemantics(chip).flagsCollection.isSelected,
              label == selected,
            );
          }
          final styles = sorts.map((s) => effectiveChip(t, s)).toList();
          await capture(t, 'sort-${sorts.indexOf(selected)}-${scale.toInt()}x', {
            'root':
                'AppTheme.lightTheme → BoxShopScreen → modal CatalogFilterPanel',
            'scale': scale,
            'styles': styles,
          });
          for (final style in styles) {
            expect(style['selected'], style['label'] == selected);
            expect(style['textContrast'], greaterThanOrEqualTo(4.5));
            if (style['selected'] as bool) {
              expect(style['showCheckmark'], isTrue);
              expect(style['checkmarkContrast'], greaterThanOrEqualTo(4.5));
            }
          }
          expect(t.takeException(), isNull);
        },
      );
    }
  }

  for (final scale in [1.0, 2.0]) {
    for (final dismiss in ['close', 'back', 'barrier']) {
      testWidgets(
        'Applied filter survives reset draft and $dismiss scale=$scale',
        (t) async {
          await mount(
            t,
            BoxShopScreen(
              boxes: r2Boxes,
              balance: '0',
              onRefresh: () async {},
              onOpen: (_) {},
              onWallet: () {},
            ),
            scale: scale,
          );
          Future<void> tap(Finder finder) async {
            await t.ensureVisible(finder);
            await t.pumpAndSettle();
            expect(finder.hitTestable(), findsOneWidget);
            await t.tap(finder);
            await t.pumpAndSettle();
          }

          Future<void> panel() => tap(find.byKey(const Key('catalog-filter')));
          List<int> ids() => t
              .widgetList<CapsuleBoxCard>(find.byType(CapsuleBoxCard))
              .map((c) => c.box.id)
              .toList();
          await panel();
          await tap(find.text('리빙'));
          await tap(find.text('높은 가격순'));
          await tap(find.byKey(const Key('catalog-filter-apply')));
          expect(find.text('리빙 · 높은 가격순'), findsOneWidget);
          expect(ids(), [9902]);
          await panel();
          await tap(find.text('필터 초기화'));
          expect(effectiveChip(t, '기본순')['selected'], isTrue);
          if (dismiss == 'close') {
            await tap(find.byTooltip('필터 닫기'));
          } else if (dismiss == 'back') {
            await t.binding.handlePopRoute();
          } else {
            // Above the sheet, inside the actual modal barrier even at 200%.
            final top = t.getTopLeft(find.byType(BottomSheet)).dy;
            expect(top, greaterThan(0));
            await t.tapAt(Offset(10, top / 2));
          }
          await t.pumpAndSettle();
          expect(find.byType(CatalogFilterPanel), findsNothing);
          expect(find.text('리빙 · 높은 가격순'), findsOneWidget);
          expect(ids(), [9902]);
          await panel();
          expect(effectiveChip(t, '높은 가격순')['selected'], isTrue);
          final category = t.widget<ChoiceChip>(
            find.ancestor(
              of: find.text('리빙'),
              matching: find.byType(ChoiceChip),
            ),
          );
          expect(category.selected, isTrue);
          await tap(find.text('필터 초기화'));
          await tap(find.text('낮은 가격순'));
          await tap(find.byKey(const Key('catalog-filter-apply')));
          expect(find.text('전체 · 낮은 가격순'), findsOneWidget);
          expect(ids().first, 9903);
          expect(t.takeException(), isNull);
        },
      );
    }
  }
  final states = <String, List<CapsuleBox>>{
    'empty': [],
    'one': [r2Boxes.first],
    'duplicate-only': [r2Boxes.first, r2Boxes.first],
    'two': r2Boxes.take(2).toList(),
    'many-with-duplicates': [r2Boxes.first, ...r2Boxes, r2Boxes.last],
    'loading': [],
    'error-empty': [],
    'error-stale': r2Boxes,
    'loading-stale': r2Boxes,
  };
  for (final scale in [1.0, 2.0]) {
    for (final state in states.entries) {
      testWidgets('Home ${state.key} section and navigation scale=$scale', (
        t,
      ) async {
        var wallet = 0, news = 0, ranking = 0, refresh = 0, shop = 0;
        final opened = <int>[];
        final loading = state.key.startsWith('loading');
        final error = state.key.startsWith('error');
        final available = !loading && !error && state.value.isNotEmpty;
        final unique = state.value.map((b) => b.id).toSet();
        final hasOther = available && unique.length > 1;
        await mount(
          t,
          HomeScreen(
            boxes: state.value,
            balance: '93,800',
            loading: loading,
            error: error ? '합성 목록 조회 실패' : null,
            onRefresh: () async {
              refresh++;
            },
            onOpen: (b) => opened.add(b.id),
            onWallet: () => wallet++,
            onShop: () => shop++,
            onRanking: () => ranking++,
            onOpenUnopened: () {},
            onCollection: () {},
            onUpdates: () => news++,
          ),
          scale: scale,
        );
        if (!loading) await t.pumpAndSettle();
        expect(
          find.byType(GachiCatalogHero),
          available ? findsOneWidget : findsNothing,
        );
        if (!hasOther) {
          expect(find.text('다른 박스도 살펴보세요'), findsNothing);
          expect(find.text('전체 보기'), findsNothing);
          expect(find.byType(CatalogGrid), findsNothing);
        }
        if (available) {
          expect(
            t.widget<GachiCatalogHero>(find.byType(GachiCatalogHero)).box.id,
            state.value.first.id,
          );
        } else if (loading) {
          expect(find.byType(GachiLoadingState), findsOneWidget);
        } else if (error) {
          expect(find.text('합성 목록 조회 실패'), findsOneWidget);
        } else {
          expect(find.text('새로운 박스를 준비하고 있어요'), findsOneWidget);
        }
        await capture(t, 'home-${state.key}-${scale.toInt()}x', {
          'uniqueBoxCount': unique.length,
          'loading': loading,
          'error': error,
          'otherSectionAndAction': hasOther,
          'scale': scale,
        });
        await t.tap(find.text('93,800 GP'));
        await t.tap(find.byTooltip('소식·고객지원'));
        expect(wallet, 1);
        expect(news, 1);
        if (available) {
          await t.ensureVisible(find.text('구성·확률 보기'));
          await t.pump(const Duration(milliseconds: 400));
          await t.tap(find.text('구성·확률 보기'));
          expect(opened, [state.value.first.id]);
        }
        if (hasOther) {
          await t.scrollUntilVisible(
            find.text('다른 박스도 살펴보세요'),
            200,
            scrollable: find.byType(Scrollable).first,
          );
          await t.pump(const Duration(milliseconds: 400));
          expect(find.text('다른 박스도 살펴보세요'), findsOneWidget);
          expect(find.byType(CatalogGrid), findsOneWidget);
          final grid = t.widget<CatalogGrid>(find.byType(CatalogGrid));
          expect(
            grid.boxes.map((b) => b.id).toList(),
            unique.skip(1).take(2).toList(),
          );
          await t.ensureVisible(find.text('전체 보기'));
          await t.pump(const Duration(milliseconds: 400));
          await t.tap(find.text('전체 보기'));
          expect(shop, 1);
        }
        if (error) {
          await t.ensureVisible(find.text('다시 불러오기'));
          await t.pump(const Duration(milliseconds: 400));
          await t.tap(find.text('다시 불러오기'));
          expect(refresh, 1);
        }
        await t.scrollUntilVisible(
          find.text('랭킹'),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        await t.pump(const Duration(milliseconds: 400));
        await t.tap(find.text('랭킹'));
        expect(ranking, 1);
        if (!hasOther) {
          expect(find.text('다른 박스도 살펴보세요'), findsNothing);
          expect(find.text('전체 보기'), findsNothing);
        }
        expect(find.byType(GachiBottomNavigation), findsOneWidget);
        expect(t.takeException(), isNull);
      });
    }
  }
  for (final url in [null, '', '   ']) {
    testWidgets(
      'Known missing photo "$url" is compact with honest copy and CTA',
      (t) async {
        final source = r2Boxes.first;
        final box = CapsuleBox(
          id: source.id,
          name: source.name,
          priceWon: source.priceWon,
          icon: source.icon,
          accentColor: source.accentColor,
          imageUrl: url,
        );
        var opened = 0;
        await mount(
          t,
          GachiScaffold(
            body: SingleChildScrollView(
              child: GachiCatalogHero(box: box, onOpen: () => opened++),
            ),
          ),
        );
        expect(find.byType(GachiProductImage), findsNothing);
        expect(find.text('GACHI / DISCOVER'), findsOneWidget);
        expect(find.text('등록된 사진이 없어요'), findsOneWidget);
        expect(find.textContaining('사진 속 상품'), findsNothing);
        expect(find.text('특정 상품의 획득은 보장되지 않아요.'), findsOneWidget);
        expect(find.text('어떤 상품을 만날지, 구성과 확률부터.'), findsOneWidget);
        expect(t.getSize(find.byType(GachiCatalogHero)).height, lessThan(330));
        await t.tap(find.text('구성·확률 보기'));
        expect(opened, 1);
      },
    );
  }
}
