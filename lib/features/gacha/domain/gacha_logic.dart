import 'dart:math';
import 'draw_result.dart';

/// 가치가차 - 뽑기(가챠) 더미 로직.
///
/// 서버 없이 클라이언트에서 가중치 기반 랜덤으로 등급을 결정하고,
/// 등급별 더미 상품 풀에서 무작위로 하나를 골라 [DrawResult]를 생성한다.
/// 추후 실제 API 연동 시 [drawGacha] 함수의 구현만 서버 호출로 교체하면
/// 되도록 인터페이스(함수 시그니처)를 단순하게 유지한다.

/// 등급별 가중치. 숫자가 클수록 당첨 확률이 높다.
/// S: 1, A: 5, B: 20, C: 74 (합계 100)
const Map<String, int> _gradeWeights = {'S': 1, 'A': 5, 'B': 20, 'C': 74};

/// 등급별 더미 상품 풀. (이름, 가격, isPremium)
/// ※ 실제 브랜드명은 사용하지 않고 일반명사로만 표기한다.
const Map<String, List<_ItemPoolEntry>> _itemPools = {
  'S': [
    _ItemPoolEntry('프리미엄 스마트폰', 1200000, true),
    _ItemPoolEntry('명품 시계', 2500000, true),
  ],
  'A': [
    _ItemPoolEntry('무선 이어폰', 329000, false),
    _ItemPoolEntry('프리미엄 지갑', 450000, false),
  ],
  'B': [
    _ItemPoolEntry('브랜드 운동화', 89000, false),
    _ItemPoolEntry('향수 세트', 65000, false),
  ],
  'C': [
    _ItemPoolEntry('카페 기프티콘', 6500, false),
    _ItemPoolEntry('편의점 상품권', 5000, false),
  ],
};

class _ItemPoolEntry {
  final String name;
  final int price;
  final bool isPremium;

  const _ItemPoolEntry(this.name, this.price, this.isPremium);
}

final Random _random = Random();

/// 가중치(weights)에 따라 하나의 등급을 랜덤으로 결정한다.
String _pickWeightedGrade() {
  final totalWeight = _gradeWeights.values.reduce((a, b) => a + b);
  final roll = _random.nextInt(totalWeight);

  int cumulative = 0;
  for (final entry in _gradeWeights.entries) {
    cumulative += entry.value;
    if (roll < cumulative) return entry.key;
  }
  return 'C'; // fallback (도달하지 않음)
}

/// 결정된 등급에 해당하는 더미 상품 풀에서 무작위로 하나를 선택해
/// [DrawResult]를 생성한다.
DrawResult _drawOne(int index) {
  final grade = _pickWeightedGrade();
  final pool = _itemPools[grade]!;
  final item = pool[_random.nextInt(pool.length)];

  return DrawResult(
    id: 'draw_${DateTime.now().microsecondsSinceEpoch}_$index',
    name: item.name,
    grade: grade,
    price: item.price,
    isPremium: item.isPremium,
  );
}

/// [count]개만큼 뽑기 결과 리스트를 생성한다.
///
/// 추후 실제 API 연동 시 이 함수를 서버 호출로 교체하면 되며,
/// 반환 타입(예: `Future<List<DrawResult>>`)만 맞춰주면 호출부 변경이
/// 최소화된다.
List<DrawResult> drawGacha(int count) {
  return List.generate(count, (index) => _drawOne(index));
}
