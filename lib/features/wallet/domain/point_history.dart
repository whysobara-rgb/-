import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';

/// 가치가차 - 포인트(GP) 내역 유형.
///
/// 충전(WalletPage) 미리보기와 마이페이지의 포인트내역 전체 페이지
/// ([PointHistoryPage])가 공통으로 사용하는 모델.
enum PointHistoryType {
  /// 지급 (뽑기 환급, 이벤트 보상 등으로 GP를 얻음)
  earn,

  /// 사용 (랜덤박스 구매 등으로 GP를 씀)
  use,

  /// 소멸 (유효기간 만료 등으로 GP가 사라짐)
  expire,
}

extension PointHistoryTypeLabel on PointHistoryType {
  String get label {
    switch (this) {
      case PointHistoryType.earn:
        return '지급';
      case PointHistoryType.use:
        return '사용';
      case PointHistoryType.expire:
        return '소멸';
    }
  }

  /// 금액 표시 색상. 지급=골드 / 사용=레드 / 소멸=그레이.
  Color get amountColor {
    switch (this) {
      case PointHistoryType.earn:
        return AppColors.goldPrimary;
      case PointHistoryType.use:
        return AppColors.error;
      case PointHistoryType.expire:
        return AppColors.textSecondary;
    }
  }

  /// 금액 앞에 붙는 +/- 기호.
  String get sign {
    switch (this) {
      case PointHistoryType.earn:
        return '+';
      case PointHistoryType.use:
      case PointHistoryType.expire:
        return '-';
    }
  }
}

/// 포인트(GP) 내역 1건.
class PointHistoryEntry {
  final String id;
  final String description;
  final PointHistoryType type;

  /// GP 금액 (항상 양수. 표시 시 [PointHistoryType.sign]을 붙인다.)
  final int amount;
  final DateTime date;

  const PointHistoryEntry({
    required this.id,
    required this.description,
    required this.type,
    required this.amount,
    required this.date,
  });

  /// 화면 표시용 금액 포맷 (예: "+500GP", "-1,000GP")
  String get formattedAmount {
    final str = amount.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return '${type.sign}${buffer.toString()}GP';
  }

  /// 화면 표시용 날짜 포맷 (예: "07.23")
  String get formattedDate {
    final mm = date.month.toString().padLeft(2, '0');
    final dd = date.day.toString().padLeft(2, '0');
    return '$mm.$dd';
  }
}

/// 포인트 내역 더미 데이터 저장소.
///
/// 추후 실제 API 연동 시 이 클래스의 구현만 교체하면 되도록
/// 인터페이스를 단순하게 유지한다.
class PointHistoryRepository {
  const PointHistoryRepository();

  List<PointHistoryEntry> getDummyHistory() {
    final now = DateTime.now();
    return [
      PointHistoryEntry(
        id: 'ph_001',
        description: '뽑기 결과 환급',
        type: PointHistoryType.earn,
        amount: 500,
        date: now.subtract(const Duration(hours: 1)),
      ),
      PointHistoryEntry(
        id: 'ph_002',
        description: '랜덤박스 구매',
        type: PointHistoryType.use,
        amount: 1000,
        date: now.subtract(const Duration(hours: 3)),
      ),
      PointHistoryEntry(
        id: 'ph_003',
        description: '이벤트 보상',
        type: PointHistoryType.earn,
        amount: 200,
        date: now.subtract(const Duration(hours: 5)),
      ),
      PointHistoryEntry(
        id: 'ph_004',
        description: '랜덤박스 구매',
        type: PointHistoryType.use,
        amount: 2000,
        date: now.subtract(const Duration(days: 1)),
      ),
      PointHistoryEntry(
        id: 'ph_005',
        description: '출석 체크 보상',
        type: PointHistoryType.earn,
        amount: 100,
        date: now.subtract(const Duration(days: 1, hours: 6)),
      ),
      PointHistoryEntry(
        id: 'ph_006',
        description: '포인트 전환 적립',
        type: PointHistoryType.earn,
        amount: 650,
        date: now.subtract(const Duration(days: 2)),
      ),
      PointHistoryEntry(
        id: 'ph_007',
        description: '랜덤박스 구매',
        type: PointHistoryType.use,
        amount: 500,
        date: now.subtract(const Duration(days: 3)),
      ),
      PointHistoryEntry(
        id: 'ph_008',
        description: '친구 초대 보상',
        type: PointHistoryType.earn,
        amount: 1000,
        date: now.subtract(const Duration(days: 4)),
      ),
      PointHistoryEntry(
        id: 'ph_009',
        description: '기간 만료 소멸',
        type: PointHistoryType.expire,
        amount: 300,
        date: now.subtract(const Duration(days: 5)),
      ),
      PointHistoryEntry(
        id: 'ph_010',
        description: '신규 가입 축하 GP',
        type: PointHistoryType.earn,
        amount: 3000,
        date: now.subtract(const Duration(days: 7)),
      ),
    ];
  }
}
