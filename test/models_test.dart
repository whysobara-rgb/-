import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/domain/rarity.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/gacha/domain/draw_result.dart';
import 'package:gacha_vault/features/gacha/domain/gacha_grade.dart';
import 'package:gacha_vault/features/gacha/domain/gacha_models.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';
import 'package:gacha_vault/features/rewards/domain/attendance.dart';
import 'package:gacha_vault/features/wallet/domain/point_history.dart';
import 'package:gacha_vault/features/wallet/domain/topup_limit.dart';

void main() {
  group('GachaDetail', () {
    test('구버전 응답: probabilityPercent/exchangeValue/pityThreshold가 없어도 파싱', () {
      final d = GachaDetail.fromJson({
        'id': 1,
        'title': '명품 시계 박스',
        'price': 500,
        'lineup': [
          {
            'itemId': 1,
            'name': 'N',
            'rarity': 'N',
            'estimatedValue': 80,
            'weight': 750,
          },
          {
            'itemId': 4,
            'name': 'S',
            'rarity': 'SSR',
            'estimatedValue': 20000,
            'weight': 250,
          },
        ],
      });
      expect(d.pityThreshold, isNull);
      expect(d.lineup.first.rarity, Rarity.ssr, reason: '희귀한 순 정렬');
      expect(d.lineup.first.probabilityPercent, closeTo(25, 1e-9));
      expect(d.lineup.first.exchangeValue, isNull);
      expect(d.rarityOdds.first.rarity, Rarity.ssr);
    });

    test('신규 응답의 확률 값을 그대로 쓴다', () {
      final item = LineupItem.fromJson({
        'itemId': 4,
        'name': '리미티드 에디션 워치',
        'rarity': 'SSR',
        'estimatedValue': 20000,
        'exchangeValue': 16000,
        'weight': 5265,
        'probabilityPercent': 0.5265,
      }, totalWeight: 1000000);
      expect(item.probabilityPercent, 0.5265);
      expect(item.exchangeValue, 16000);
    });
  });

  test('GachaOdds: pity null, rarities 누락 시 items로 합산', () {
    final odds = GachaOdds.fromJson({
      'gachaId': 2,
      'title': 't',
      'price': 500,
      'items': [
        {'itemId': 1, 'rarity': 'N', 'weight': 60, 'probabilityPercent': 60},
        {'itemId': 2, 'rarity': 'R', 'weight': 40, 'probabilityPercent': 40},
      ],
      'pity': null,
    });
    expect(odds.pity, isNull);
    expect(odds.rarities.map((r) => r.rarity), [Rarity.r, Rarity.n]);
    expect(odds.bonusEvery, 10);
    expect(odds.exchangeRatePercent, 80);
  });

  test('DrawOutcome: highestRarity가 없으면 결과에서 계산, 라벨 플래그 파싱', () {
    final o = DrawOutcome.fromJson({
      'gachaId': 1,
      'count': 10,
      'bonusCount': 1,
      'spent': 5000,
      'balanceAfter': 1000,
      'results': [
        {
          'drawId': 1,
          'inventoryItemId': 11,
          'itemId': 1,
          'name': 'a',
          'rarity': 'N',
          'estimatedValue': 80,
          'exchangeValue': 64,
        },
        {
          'drawId': 2,
          'inventoryItemId': 12,
          'itemId': 3,
          'name': 'b',
          'rarity': 'SR',
          'estimatedValue': 3000,
          'exchangeValue': 2400,
          'isBonus': true,
        },
      ],
    });
    expect(o.highestRarity, Rarity.sr);
    expect(o.best!.name, 'b');
    expect(o.best!.isBonus, isTrue);
    expect(o.totalExchange, 2464);
    expect(o.inventoryItemIds, [11, 12]);
    expect(GachaGrade.fromRarity(o.highestRarity), GachaGrade.s);
  });

  test('승급 색은 실제 등급에서 멈춘다 (니어미스 없음)', () {
    expect(GachaGrade.b.ascensionColors.length, 2);
    expect(GachaGrade.a.ascensionColors.last, GachaGrade.a.primaryColor);
    expect(GachaGrade.s.ascensionColors.last, GachaGrade.s.primaryColor);
    expect(GachaGrade.sss.ascensionColors.last, GachaGrade.sss.primaryColor);
  });

  test('InventoryItem: EXCHANGED 상태와 exchangeValue 누락', () {
    final a = InventoryItem.fromJson({
      'inventoryItemId': 1,
      'name': 'x',
      'rarity': 'R',
      'status': 'EXCHANGED',
    });
    expect(a.status, InventoryStatus.exchanged);
    expect(a.isActionable, isFalse);
    final b = InventoryItem.fromJson({
      'inventoryItemId': 2,
      'name': 'y',
      'rarity': 'R',
      'status': 'STORED',
      'estimatedValue': 400,
    });
    expect(b.isActionable, isTrue);
    expect(b.canExchange, isFalse, reason: 'exchangeValue가 없으면 전환 버튼을 막는다');
  });

  test('AttendanceStatus: 오늘 출석 전/후 칸 채우기', () {
    final schedule = [
      for (var d = 1; d <= 7; d++) {'day': d, 'reward': d == 7 ? 500 : 100},
    ];
    final before = AttendanceStatus.fromJson({
      'today': '2026-10-07',
      'checkedInToday': false,
      'streakDay': 2,
      'nextStreakDay': 3,
      'nextReward': 150,
      'schedule': schedule,
    });
    expect(before.isDone(2), isTrue);
    expect(before.isDone(3), isFalse);
    expect(before.todayDay, 3);
    final after = AttendanceStatus.fromJson({
      'checkedInToday': true,
      'streakDay': 7,
      'nextStreakDay': 1,
      'schedule': schedule,
    });
    expect(after.isDone(7), isTrue);
    expect(after.tomorrowReward, 100, reason: '7일 뒤에는 1일차로 돌아간다');
  });

  test('TopupLimit: 한도 없음/있음/예약', () {
    final none = TopupLimit.fromJson({
      'monthlyLimit': null,
      'usedThisMonth': 208000,
      'remainingThisMonth': null,
      'pending': null,
    });
    expect(none.hasLimit, isFalse);
    final some = TopupLimit.fromJson({
      'monthlyLimit': 100000,
      'usedThisMonth': 25000,
      'pending': {'monthlyLimit': null, 'effectiveAt': '2026-10-14T00:00:00Z'},
    });
    expect(some.remainingThisMonth, 75000);
    expect(some.usedRatio, 0.25);
    expect(some.pending!.monthlyLimit, isNull);
  });

  test('PointHistoryEntry: reason 매핑과 구버전 null', () {
    final e = PointHistoryEntry.fromJson({
      'id': 1,
      'type': 'USE',
      'reason': 'DRAW',
      'amount': -500,
      'description': '명품 시계 박스 뽑기',
      'createdAt': '2026-10-07T04:16:13Z',
    });
    expect(e.reason, PointReason.draw);
    expect(e.signedAmount, -500);
    expect(e.detail, '명품 시계 박스 뽑기');
    final old = PointHistoryEntry.fromJson({
      'id': 2,
      'type': 'EARN',
      'amount': 1000,
      'description': 'GP 충전',
    });
    expect(old.reason, PointReason.other);
    expect(old.title, 'GP 충전');
    final topup = PointHistoryEntry.fromJson({
      'id': 3,
      'type': 'EARN',
      'reason': 'TOPUP',
      'amount': 1000,
      'description': 'GP 충전',
    });
    expect(topup.title, '충전');
    expect(topup.detail, isNull);
  });

  test('ApiException은 영어 서버 메시지를 우리말로 바꾼다', () {
    expect(
      ApiException(
        statusCode: 10006,
        message: 'Insufficient balance',
      ).displayMessage,
      'GP가 부족해요',
    );
    expect(
      ApiException(
        statusCode: 10007,
        message: 'Monthly top-up limit exceeded (remaining 75000 GP)',
      ).displayMessage,
      '이번 달 충전 한도를 넘어요. 남은 한도는 75,000원이에요',
    );
    expect(
      ApiException(statusCode: 10008, message: 'whatever').displayMessage,
      '오늘은 이미 출석했어요',
    );
    expect(
      ApiException(statusCode: 10099, message: '서버 점검 중이에요').displayMessage,
      '서버 점검 중이에요',
    );
  });
}
