import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';

/// 가치가차 - 포인트(GP) 내역 유형.
///
/// 충전(WalletPage) 미리보기와 마이페이지의 포인트내역 전체 페이지
/// ([PointHistoryPage])가 공통으로 사용하는 모델.
/// 백엔드 `WalletTransactionType` enum(EARN/USE/EXPIRE)과 1:1 대응된다.
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

/// 백엔드 type 문자열("EARN"/"USE"/"EXPIRE") -> Flutter [PointHistoryType] 변환.
PointHistoryType _typeFromBackend(String? backendType) {
  switch (backendType) {
    case 'USE':
      return PointHistoryType.use;
    case 'EXPIRE':
      return PointHistoryType.expire;
    case 'EARN':
    default:
      return PointHistoryType.earn;
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

  /// 백엔드 `GET /wallet/point-history` 응답의 items[] 항목 1개를 변환한다.
  /// 백엔드 amount는 부호가 있는 값(EARN=양수, USE/EXPIRE=음수)이므로
  /// 절대값으로 변환해 저장한다 (부호 표시는 [PointHistoryType.sign] 사용).
  factory PointHistoryEntry.fromJson(Map<String, dynamic> json) {
    final createdAtRaw = json['createdAt'] as String?;
    final rawAmount = (json['amount'] as num?)?.toInt() ?? 0;
    return PointHistoryEntry(
      id: (json['id'] as num).toString(),
      description: json['description'] as String? ?? '',
      type: _typeFromBackend(json['type'] as String?),
      amount: rawAmount.abs(),
      date: createdAtRaw != null
          ? (DateTime.tryParse(createdAtRaw) ?? DateTime.now())
          : DateTime.now(),
    );
  }

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

/// 포인트 내역 저장소. 백엔드 `GET /wallet/point-history`와 통신한다.
class PointHistoryRepository {
  final ApiClient _apiClient;

  const PointHistoryRepository({ApiClient apiClient = const ApiClient()})
    : _apiClient = apiClient;

  /// 포인트 내역 목록을 조회한다.
  /// [type]을 지정하면 해당 유형(지급/사용/소멸)만 필터링한다.
  /// [limit]으로 조회 개수를 제한할 수 있다 (미리보기용, 기본 100).
  Future<List<PointHistoryEntry>> getAll({
    PointHistoryType? type,
    int limit = 100,
  }) async {
    final query = <String>['page=1', 'limit=$limit'];
    if (type != null) {
      final backendType = switch (type) {
        PointHistoryType.earn => 'EARN',
        PointHistoryType.use => 'USE',
        PointHistoryType.expire => 'EXPIRE',
      };
      query.add('type=$backendType');
    }
    final data = await _apiClient.get(
      '/wallet/point-history?${query.join('&')}',
    );
    final map = data as Map<String, dynamic>;
    final items = map['items'] as List<dynamic>? ?? [];
    return items
        .map((e) => PointHistoryEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
