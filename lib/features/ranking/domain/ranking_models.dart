// 랭킹 탭 모델 (`GET /rankings/users`, `/rankings/gachas`, `/rankings/wins`).
import '../../../core/domain/rarity.dart';
import '../../../core/utils/format.dart';

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

  factory UserRankingItem.fromJson(Map<String, dynamic> json) =>
      UserRankingItem(
        rank: asInt(json['rank']),
        userId: asInt(json['userId']),
        nickname: asStringOrNull(json['nickname']) ?? '',
        drawCount: asInt(json['drawCount']),
        totalValue: asInt(json['totalValue']),
      );
}

class GachaRankingItem {
  final int rank;
  final int gachaId;
  final String title;
  final String? imageUrl;
  final int price;
  final int drawCount;

  const GachaRankingItem({
    required this.rank,
    required this.gachaId,
    required this.title,
    required this.price,
    required this.drawCount,
    this.imageUrl,
  });

  factory GachaRankingItem.fromJson(Map<String, dynamic> json) =>
      GachaRankingItem(
        rank: asInt(json['rank']),
        gachaId: asInt(json['gachaId']),
        title: asStringOrNull(json['title']) ?? '',
        imageUrl: asStringOrNull(json['imageUrl']),
        price: asInt(json['price']),
        drawCount: asInt(json['drawCount']),
      );
}

/// 최근 당첨 기록 (서버가 준 그대로. 닉네임 마스킹도 서버가 한다).
class WinFeedItem {
  final int inventoryItemId;
  final String nickname;
  final String gachaTitle;
  final String itemName;
  final Rarity rarity;
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
    required this.wonAt,
    this.imageUrl,
  });

  factory WinFeedItem.fromJson(Map<String, dynamic> json) => WinFeedItem(
    inventoryItemId: asInt(json['inventoryItemId']),
    nickname: asStringOrNull(json['nickname']) ?? '',
    gachaTitle: asStringOrNull(json['gachaTitle']) ?? '',
    itemName: asStringOrNull(json['itemName']) ?? '',
    rarity: Rarity.fromCode(json['rarity']),
    estimatedValue: asInt(json['estimatedValue']),
    imageUrl: asStringOrNull(json['imageUrl']),
    wonAt: asDateOrNull(json['wonAt']) ?? DateTime.now(),
  );

  String get relativeTimeLabel {
    final diff = DateTime.now().toUtc().difference(wonAt.toUtc());
    if (diff.inMinutes < 1) return '방금';
    if (diff.inMinutes < 60) return '${diff.inMinutes}분 전';
    if (diff.inHours < 24) return '${diff.inHours}시간 전';
    return '${diff.inDays}일 전';
  }
}
