import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/grade_mapper.dart';

/// 가치가차 - 보관함(내 박스)에 보관 중인 뽑기 획득 상품의 배송/처리 상태.
///
/// 백엔드 `InventoryStatus` enum(STORED/SHIPPING_REQUESTED/SHIPPING/DELIVERED)과
/// 1:1 대응된다 (변환은 [_statusFromBackend]/[_statusToBackend] 참고).
enum InventoryStatus {
  /// 보관중 (아직 별도 요청 없음)
  stored,

  /// 배송요청 (사용자가 배송을 요청한 상태)
  shippingRequested,

  /// 배송중
  shipping,

  /// 배송완료
  delivered,

  /// Unknown states must never permit shipping or conversion.
  unavailable,
}

extension InventoryStatusLabel on InventoryStatus {
  String get label {
    switch (this) {
      case InventoryStatus.stored:
        return '보관중';
      case InventoryStatus.shippingRequested:
        return '배송요청';
      case InventoryStatus.shipping:
        return '배송중';
      case InventoryStatus.delivered:
        return '배송완료';
      case InventoryStatus.unavailable:
        return '처리 상태 확인 필요';
    }
  }
}

/// 백엔드 status 문자열("STORED" 등) -> Flutter [InventoryStatus] 변환.
InventoryStatus _statusFromBackend(String? backendStatus) {
  switch (backendStatus) {
    case 'SHIPPING_REQUESTED':
      return InventoryStatus.shippingRequested;
    case 'SHIPPING':
      return InventoryStatus.shipping;
    case 'DELIVERED':
      return InventoryStatus.delivered;
    case 'STORED':
      return InventoryStatus.stored;
    default:
      return InventoryStatus.unavailable;
  }
}

/// Flutter [InventoryStatus] -> 백엔드 status 문자열 변환 (목록 조회 필터용).
String _statusToBackend(InventoryStatus status) {
  switch (status) {
    case InventoryStatus.stored:
      return 'STORED';
    case InventoryStatus.shippingRequested:
      return 'SHIPPING_REQUESTED';
    case InventoryStatus.shipping:
      return 'SHIPPING';
    case InventoryStatus.delivered:
      return 'DELIVERED';
    case InventoryStatus.unavailable:
      return 'UNAVAILABLE';
  }
}

/// 백엔드 아이템은 gacha와 달리 개별 iconName을 내려주지 않으므로,
/// 등급(rarity)에 따라 대표 아이콘을 매핑한다.
IconData _iconForRarity(String? rarity) {
  switch (rarity) {
    case 'SSR':
      return Icons.workspace_premium_rounded;
    case 'SR':
      return Icons.auto_awesome_rounded;
    case 'R':
      return Icons.card_giftcard_rounded;
    case 'N':
    default:
      return Icons.inventory_2_rounded;
  }
}

/// 가치가차 - 보관함에 표시되는 뽑기 획득 상품 아이템 모델.
///
/// 백엔드 `GET /inventory` 응답 항목을 그대로 반영한다.
class InventoryItem {
  /// 리스트/선택(Set) 식별자로 사용되는 문자열 ID.
  /// 실제 값은 백엔드 `inventoryItemId`(숫자)의 문자열 표현이다.
  final String id;
  final String name;

  /// 등급 코드 ("S"/"A"/"B"/"C"). 백엔드 rarity(N/R/SR/SSR)를 [GradeMapper]로 변환한 값.
  final String grade;

  /// 상품 추정 가치 (GP).
  final int price;

  final IconData icon;
  final String? imageUrl;

  final InventoryStatus status;

  /// 잠금은 포인트 전환만 제한한다. 배송은 보관 상태이면 가능하다.
  final bool isLocked;

  /// 획득 시각 (최근 획득순 정렬에 사용).
  final DateTime acquiredAt;

  const InventoryItem({
    required this.id,
    required this.name,
    required this.grade,
    required this.price,
    required this.icon,
    required this.status,
    required this.acquiredAt,
    this.isLocked = false,
    this.imageUrl,
  });

  bool get canShip => status == InventoryStatus.stored;
  bool get canConvert => canShip && !isLocked;

  /// 배송 신청(`POST /shipping-requests`) 시 백엔드에 전달할 숫자 PK.
  int get numericId {
    final value = int.tryParse(id);
    if (value == null || value <= 0) {
      throw const FormatException('유효하지 않은 보관함 상품 ID');
    }
    return value;
  }

  /// 백엔드 `GET /inventory` 응답의 items[] 항목 1개를 [InventoryItem]으로 변환한다.
  factory InventoryItem.fromJson(Map<String, dynamic> json) {
    final rarity = json['rarity'] as String?;
    final acquiredAtRaw = json['acquiredAt'] as String?;
    return InventoryItem(
      id: (json['inventoryItemId'] as num).toString(),
      name: json['name'] as String? ?? '',
      grade: GradeMapper.toUiGrade(rarity),
      price: (json['estimatedValue'] as num?)?.toInt() ?? 0,
      icon: _iconForRarity(rarity),
      imageUrl: json['imageUrl'] as String?,
      status: _statusFromBackend(json['status'] as String?),
      acquiredAt: acquiredAtRaw != null
          ? (DateTime.tryParse(acquiredAtRaw) ?? DateTime.now())
          : DateTime.now(),
      isLocked: json['isLocked'] as bool? ?? false,
    );
  }

  /// 화면 표시용 가격 포맷 (예: "1,200,000 GP")
  String get formattedPrice {
    final str = price.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return '${buffer.toString()} GP';
  }
}

/// 정렬 기준.
enum InventorySortOption {
  /// 최근 획득순 (기본)
  recentFirst,

  /// 획득가치 높은순
  valueHighToLow,

  /// 획득가치 낮은순
  valueLowToHigh,
}

extension InventorySortOptionLabel on InventorySortOption {
  String get label {
    switch (this) {
      case InventorySortOption.recentFirst:
        return '최근 획득순';
      case InventorySortOption.valueHighToLow:
        return '획득가치 높은순';
      case InventorySortOption.valueLowToHigh:
        return '획득가치 낮은순';
    }
  }
}

/// 보관함 데이터 저장소. 백엔드 `GET /inventory`와 통신한다.
class InventoryRepository {
  final ApiClient _apiClient;

  const InventoryRepository({ApiClient apiClient = const ApiClient()})
    : _apiClient = apiClient;

  Future<void> setLock(InventoryItem item, {required bool locked}) async {
    if (!item.canShip) throw StateError('보관중인 상품만 잠금을 변경할 수 있습니다');
    final data = await _apiClient.put(
      '/inventory/${item.numericId}/lock',
      body: {'locked': locked},
    );
    if (data is! Map<String, dynamic> ||
        data['inventoryItemId'] != item.numericId ||
        data['isLocked'] != locked) {
      throw ApiException(
        statusCode: 0,
        message: '잠금 상태를 확인하지 못했습니다. 보관함을 새로고침해주세요',
      );
    }
  }

  /// 보관함 전체 목록을 조회한다. [status]를 지정하면 해당 상태만 필터링한다.
  Future<List<InventoryItem>> getAll({InventoryStatus? status}) async {
    final result = <InventoryItem>[];
    final ids = <String>{};
    var page = 1;
    while (true) {
      final query = <String>['page=$page', 'limit=100'];
      if (status != null) query.add('status=${_statusToBackend(status)}');
      final data = await _apiClient.get('/inventory?${query.join('&')}');
      if (data is! Map<String, dynamic> ||
          data['items'] is! List ||
          data['totalCount'] is! int ||
          (data['totalCount'] as int) < 0 ||
          data['page'] != page ||
          data['limit'] is! int ||
          (data['limit'] as int) <= 0) {
        throw ApiException(statusCode: 0, message: '보관함 응답을 확인하지 못했습니다');
      }
      final rows = data['items'] as List;
      final limit = data['limit'] as int;
      for (final row in rows) {
        final item = InventoryItem.fromJson(row as Map<String, dynamic>);
        if (!ids.add(item.id)) {
          throw ApiException(statusCode: 0,
              message: '보관함 목록이 변경되었습니다. 새로고침해주세요');
        }
        result.add(item);
      }
      if (page * limit >= (data['totalCount'] as int)) return result;
      if (rows.length != limit) {
        throw ApiException(statusCode: 0,
            message: '보관함 목록 일부를 확인하지 못했습니다. 새로고침해주세요');
      }
      page++;
    }
  }
}
