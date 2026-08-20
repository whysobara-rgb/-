// 가치가차 - 랭킹 탭 도메인 모델.
//
// 백엔드 `GET /rankings/users`, `/rankings/gachas`, `/rankings/wins`
// 3개 엔드포인트 응답을 각각 매핑한다.

/// 유저 랭킹 (누적 뽑기 횟수 / 누적 획득 가치 기준).
class UserRankingItem {
  final int rank;
  final int userId;
  final String nickname;
  final int drawCount;
  final int totalValue;

  const UserRankingItem({
    required this.rank,
    required this.userId,
    required this.nickname,
    required this.drawCount,
    required this.totalValue,
  });

  factory UserRankingItem.fromJson(Map<String, dynamic> json) {
    return UserRankingItem(
      rank: json['rank'] as int,
      userId: json['userId'] as int,
      nickname: json['nickname'] as String,
      drawCount: (json['drawCount'] as num).toInt(),
      totalValue: (json['totalValue'] as num).toInt(),
    );
  }
}

/// 인기 박스 랭킹 (누적 뽑기 횟수 기준).
class GachaRankingItem {
  final int rank;
  final int gachaId;
  final String title;
  final String? imageUrl;
  final String accentColorHex;
  final int price;
  final int drawCount;

  const GachaRankingItem({
    required this.rank,
    required this.gachaId,
    required this.title,
    this.imageUrl,
    required this.accentColorHex,
    required this.price,
    required this.drawCount,
  });

  factory GachaRankingItem.fromJson(Map<String, dynamic> json) {
    return GachaRankingItem(
      rank: json['rank'] as int,
      gachaId: json['gachaId'] as int,
      title: json['title'] as String,
      imageUrl: json['imageUrl'] as String?,
      accentColorHex: json['accentColorHex'] as String? ?? '#9AA0A6',
      price: (json['price'] as num).toInt(),
      drawCount: (json['drawCount'] as num).toInt(),
    );
  }
}

/// 실시간 당첨 피드 아이템.
class WinFeedItem {
  final int inventoryItemId;
  final String nickname;
  final String gachaTitle;
  final String itemName;
  final String rarity;
  final int estimatedValue;
  final String? imageUrl;
  final DateTime wonAt;

  const WinFeedItem({
    required this.inventoryItemId,
    required this.nickname,
    required this.gachaTitle,
    required this.itemName,
    required this.rarity,
    required this.estimatedValue,
    this.imageUrl,
    required this.wonAt,
  });

  factory WinFeedItem.fromJson(Map<String, dynamic> json) {
    return WinFeedItem(
      inventoryItemId: json['inventoryItemId'] as int,
      nickname: json['nickname'] as String,
      gachaTitle: json['gachaTitle'] as String,
      itemName: json['itemName'] as String,
      rarity: json['rarity'] as String? ?? 'N',
      estimatedValue: (json['estimatedValue'] as num?)?.toInt() ?? 0,
      imageUrl: json['imageUrl'] as String?,
      wonAt: DateTime.tryParse(json['wonAt'] as String? ?? '') ??
          DateTime.now(),
    );
  }

  /// "3분 전", "방금 전" 등 상대 시간 라벨.
  String get relativeTimeLabel {
    final diff = DateTime.now().toUtc().difference(wonAt.toUtc());
    if (diff.inSeconds < 60) return '방금 전';
    if (diff.inMinutes < 60) return '${diff.inMinutes}분 전';
    if (diff.inHours < 24) return '${diff.inHours}시간 전';
    return '${diff.inDays}일 전';
  }
}
