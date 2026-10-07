import 'dart:math' as math;

/// 서버 규칙을 그대로 옮긴 순수 함수들(입출력 없음).
///
/// 원본(gacha-vault-backend):
/// - `src/common/constants/economy.constant.ts`  경제 파라미터
/// - `src/modules/gacha/gacha-economy.ts`        확률·기대값·천장 통계
/// - `src/modules/draws/draw-engine.ts`          가중치 추첨·천장·10+1
/// - `src/modules/rewards/attendance.ts`         출석 7일 주기
/// - `src/common/utils/kst-date.ts`              KST 날짜
/// - `src/modules/wallet/topup-limit.ts`         월 충전 한도
/// - `src/modules/payments/payments.service.ts`  첫 충전 보너스
/// - `src/modules/shipping/shipping.service.ts`  배송비
///
/// 서버 코드가 바뀌면 여기도 같이 바꾼다. `test/demo_backend_test.dart`가
/// 스냅샷의 확률 공시 값을 이 함수들로 다시 계산해 서버와 같은지 확인한다.

// ── economy.constant.ts ─────────────────────────────────────────────

/// 천장이 보장하는 등급.
const String topTierRarity = 'SSR';

/// 표시·정렬 순서(희귀한 것부터).
const Map<String, int> rarityRank = {'SSR': 0, 'SR': 1, 'R': 2, 'N': 3};

/// 10+1: 한 번에 10회 결제할 때마다 1회 무료.
const int multiDrawBonusEvery = 10;
const int multiDrawBonusBonus = 1;

/// 포인트 전환율(예상 가치의 80%).
const double itemExchangeRate = 0.8;

/// 출석 1~7일차 보상. 7일 뒤 다시 1일차.
const List<int> attendanceRewards = [100, 100, 150, 150, 200, 200, 500];

/// 월 충전 한도를 올리거나 풀면 이만큼 뒤에 적용된다. 낮추면 즉시.
const int topupLimitIncreaseDelayDays = 7;

/// 가입 축하 GP.
const int welcomeGp = 3000;

/// 첫 충전 보너스(산 GP의 20%, 최대 10,000 GP). 카탈로그 스냅샷 값과 같다.
const double firstTopupBonusRate = 0.2;
const int firstTopupBonusMaxGp = 10000;

/// 배송 신청 1건당 배송비(GP).
const int deliveryFee = 3000;

// ── gacha-economy.ts ────────────────────────────────────────────────

/// 확률 계산에 쓰는 풀 항목.
class EconomyEntry {
  final String rarity;
  final int weight;
  final int estimatedValue;
  const EconomyEntry(this.rarity, this.weight, this.estimatedValue);
}

int totalWeight(Iterable<int> weights) => weights.fold(0, (s, w) => s + w);

double probabilityOf(int weight, int total) => total > 0 ? weight / total : 0;

double expectedValue(List<EconomyEntry> entries) {
  final total = totalWeight(entries.map((e) => e.weight));
  if (total == 0) return 0;
  return entries.fold<double>(0, (s, e) => s + e.weight * e.estimatedValue) /
      total;
}

/// 포인트 전환 GP. JS `Math.floor(v * 0.8)`와 같은 부동소수 연산이다.
int exchangeValueOf(int estimatedValue) =>
    (estimatedValue * itemExchangeRate).floor();

/// [paidCount]회 결제에 붙는 무료 보너스 뽑기 수(10+1).
int bonusDrawsFor(int paidCount) =>
    (paidCount ~/ multiDrawBonusEvery) * multiDrawBonusBonus;

/// API가 내려주는 천장 진행도.
Map<String, dynamic> pityProgress(int? threshold, int drawsSinceTopTier) => {
  'threshold': threshold,
  'drawsSinceTopTier': drawsSinceTopTier,
  'remaining': threshold == null
      ? null
      : math.max(0, threshold - drawsSinceTopTier),
};

class PityStats {
  final double? expectedDrawsToTopTier;
  final double effectiveTopTierRate;
  final double expectedValue;
  const PityStats(
    this.expectedDrawsToTopTier,
    this.effectiveTopTierRate,
    this.expectedValue,
  );
}

/// 천장을 반영한 장기 통계(재생 보상 정리). 서버 `pityStats`와 같다.
PityStats pityStats(List<EconomyEntry> entries, int? threshold) {
  final top = entries.where((e) => e.rarity == topTierRarity).toList();
  final others = entries.where((e) => e.rarity != topTierRarity).toList();
  final total = totalWeight(entries.map((e) => e.weight));
  final topWeight = totalWeight(top.map((e) => e.weight));
  final p = total > 0 ? topWeight / total : 0.0;

  if (top.isEmpty || topWeight == 0) {
    return PityStats(null, 0, expectedValue(entries));
  }
  if (threshold == null || threshold == 0 || others.isEmpty) {
    return PityStats(1 / p, p, expectedValue(entries));
  }
  final cycleLength = p >= 1 ? 1.0 : (1 - math.pow(1 - p, threshold)) / p;
  final value =
      (expectedValue(top) + (cycleLength - 1) * expectedValue(others)) /
      cycleLength;
  return PityStats(cycleLength, 1 / cycleLength, value);
}

class EconomySummary {
  final double expectedValue;
  final PityStats pity;
  final double payoutRatio;
  final double multiDrawPayoutRatio;
  final double exchangeReturnRatio;
  const EconomySummary(
    this.expectedValue,
    this.pity,
    this.payoutRatio,
    this.multiDrawPayoutRatio,
    this.exchangeReturnRatio,
  );
}

EconomySummary summarizeEconomy(
  List<EconomyEntry> entries,
  int price,
  int? pityThreshold,
) {
  final pity = pityStats(entries, pityThreshold);
  final payoutRatio = price > 0 ? pity.expectedValue / price : 0.0;
  final multi =
      (payoutRatio * (multiDrawBonusEvery + multiDrawBonusBonus)) /
      multiDrawBonusEvery;
  return EconomySummary(
    expectedValue(entries),
    pity,
    payoutRatio,
    multi,
    multi * itemExchangeRate,
  );
}

/// 비율(0..1) → 소수 넷째 자리 퍼센트. JS `Math.round(r*1e6)/1e4`.
double toPercent(double ratio) => jsRound(ratio * 1000000) / 10000;

/// JS `Math.round`: .5는 +∞ 쪽으로.
int jsRound(double x) => (x + 0.5).floor();

/// JS `Math.round(x * 1000) / 10` (환급률 표기).
double roundRatioPercent(double ratio) => jsRound(ratio * 1000) / 10;

// ── draw-engine.ts ──────────────────────────────────────────────────

/// [0, maxExclusive) 정수. 실제 뽑기는 `Random.secure().nextInt`.
typedef RandomIntFn = int Function(int maxExclusive);

/// 가중치 풀의 한 항목.
abstract class Weighted {
  int get weight;
  String get rarity;
}

T pickWeighted<T extends Weighted>(List<T> entries, RandomIntFn rng) {
  final total = totalWeight(entries.map((e) => e.weight));
  if (entries.isEmpty || total <= 0) {
    throw StateError('Cannot pick from an empty or zero-weight pool');
  }
  var roll = rng(total);
  for (final entry in entries) {
    if (roll < entry.weight) return entry;
    roll -= entry.weight;
  }
  // rng가 [0, total) 약속을 지키면 오지 않는다.
  return entries.last;
}

class PlannedDraw<T> {
  final T entry;
  final bool isPity;
  final bool isBonus;
  const PlannedDraw(this.entry, {required this.isPity, required this.isBonus});
}

class DrawPlan<T> {
  final List<PlannedDraw<T>> draws;
  final int bonusCount;

  /// 저장할 천장 카운터.
  final int drawsSinceTopTier;
  const DrawPlan(this.draws, this.bonusCount, this.drawsSinceTopTier);
}

/// [paidCount]회 + 10+1 보너스를 정한다.
///
/// 천장: SSR 없이 `pityThreshold - 1`회를 뽑았으면 다음 뽑기는 SSR 중에서만
/// 고른다. 보너스 뽑기도 천장 카운트에 들어가고 천장을 터뜨릴 수 있다.
DrawPlan<T> planDraws<T extends Weighted>({
  required List<T> pool,
  required int paidCount,
  required int? pityThreshold,
  required int drawsSinceTopTier,
  required RandomIntFn rng,
}) {
  final topTier = pool
      .where((e) => e.rarity == topTierRarity && e.weight > 0)
      .toList();
  final pityActive =
      pityThreshold != null && pityThreshold != 0 && topTier.isNotEmpty;
  final bonusCount = bonusDrawsFor(paidCount);

  var counter = drawsSinceTopTier;
  final draws = <PlannedDraw<T>>[];
  for (var i = 0; i < paidCount + bonusCount; i++) {
    final isPity = pityActive && counter + 1 >= pityThreshold;
    final entry = isPity ? pickWeighted(topTier, rng) : pickWeighted(pool, rng);
    counter = entry.rarity == topTierRarity ? 0 : counter + 1;
    draws.add(PlannedDraw(entry, isPity: isPity, isBonus: i >= paidCount));
  }
  return DrawPlan(draws, bonusCount, counter);
}

String? highestRarity(List<String> rarities) {
  if (rarities.isEmpty) return null;
  return rarities.reduce(
    (best, r) => (rarityRank[r] ?? 99) < (rarityRank[best] ?? 99) ? r : best,
  );
}

// ── kst-date.ts ─────────────────────────────────────────────────────

const Duration _kstOffset = Duration(hours: 9);

/// [date]가 속한 KST 날짜 'YYYY-MM-DD'.
String toKstDateString(DateTime date) => _isoDate(date.toUtc().add(_kstOffset));

/// 'YYYY-MM-DD'를 날짜 단위로 옮긴다.
String addDays(String dateString, int days) => _isoDate(
  DateTime.parse('${dateString}T00:00:00Z').add(Duration(days: days)),
);

/// [date]가 속한 KST 달이 시작된 순간.
DateTime startOfKstMonth(DateTime date) {
  final kst = date.toUtc().add(_kstOffset);
  return DateTime.utc(kst.year, kst.month, 1).subtract(_kstOffset);
}

/// [date]가 속한 KST 날이 시작된 순간(관리자 대시보드 '오늘').
DateTime startOfKstDay(DateTime date) =>
    DateTime.parse('${toKstDateString(date)}T00:00:00Z').subtract(_kstOffset);

String _isoDate(DateTime utc) {
  String two(int v) => v.toString().padLeft(2, '0');
  return '${utc.year.toString().padLeft(4, '0')}-${two(utc.month)}-${two(utc.day)}';
}

// ── attendance.ts ───────────────────────────────────────────────────

/// 연속 KST 날짜면 1..7 다음 일차, 하루라도 빠지면 1일차.
int nextStreakDay(({String checkinDate, int streakDay})? last, String today) {
  if (last == null || last.checkinDate != addDays(today, -1)) return 1;
  return (last.streakDay % attendanceRewards.length) + 1;
}

int rewardForStreakDay(int streakDay) => attendanceRewards[streakDay - 1];

// ── topup-limit.ts ──────────────────────────────────────────────────

class TopupLimitState {
  final int? monthlyTopupLimit;
  final int? pendingMonthlyTopupLimit;
  final DateTime? pendingTopupLimitEffectiveAt;
  const TopupLimitState(
    this.monthlyTopupLimit,
    this.pendingMonthlyTopupLimit,
    this.pendingTopupLimitEffectiveAt,
  );
}

/// 적용 시각이 지난 대기 변경을 반영한다. 바뀐 게 없으면 같은 객체.
TopupLimitState resolveTopupLimit(TopupLimitState state, DateTime now) {
  final due = state.pendingTopupLimitEffectiveAt;
  if (due == null || due.isAfter(now)) return state;
  return TopupLimitState(state.pendingMonthlyTopupLimit, null, null);
}

/// 낮추면(또는 처음 정하면) 즉시, 올리거나 해제하면 7일 뒤.
TopupLimitState requestTopupLimitChange(
  TopupLimitState state,
  int? requested,
  DateTime now,
) {
  final current = resolveTopupLimit(state, now).monthlyTopupLimit;
  final tightens =
      requested != null && (current == null || requested <= current);
  if (tightens) return TopupLimitState(requested, null, null);
  return TopupLimitState(
    current,
    requested,
    now.add(const Duration(days: topupLimitIncreaseDelayDays)),
  );
}

// ── payments.service.ts ─────────────────────────────────────────────

/// 첫 충전 보너스: 산 GP의 [rate], 최대 [maxGp].
int firstTopupBonusFor(
  int gp, {
  double rate = firstTopupBonusRate,
  int maxGp = firstTopupBonusMaxGp,
}) => math.min((gp * rate).floor(), maxGp);
