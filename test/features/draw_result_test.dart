import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/features/gacha/domain/draw_result.dart';

void main() {
  test('never invents a conversion amount or premium classification', () {
    final result = DrawResult.fromJson({
      'drawId': 1,
      'rarity': 'SSR',
      'estimatedValue': 10000,
    });
    expect(result.conversionGp, isNull);
    expect(result.isPremium, isFalse);
    expect(result.formattedConversionGp, '견적 확인 필요');
  });
  test('displays the server conversion snapshot exactly', () {
    final result = DrawResult.fromJson({
      'drawId': 1,
      'estimatedValue': 10000,
      'conversionGp': 1000,
    });
    expect(result.formattedConversionGp, '1,000 GP');
  });
  test('premium highlight prioritizes value over grade', () {
    final items = [
      const DrawResult(
        id: '1',
        name: '',
        grade: 'SSS',
        price: 100,
        isPremium: true,
      ),
      const DrawResult(
        id: '2',
        name: '',
        grade: 'S',
        price: 200,
        isPremium: true,
      ),
    ]..sort(DrawResult.compareForReveal);
    expect(items.first.id, '2');
  });
}
