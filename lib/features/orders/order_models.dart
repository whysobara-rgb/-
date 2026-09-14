import '../../core/network/api_client.dart';
import '../../core/utils/grade_mapper.dart';

Never invalidResponse() => throw ApiException(
  statusCode: 0,
  message: '거래 응답을 확인하지 못했습니다. 같은 요청으로 결과를 다시 확인해주세요',
);
Map<String, dynamic> object(dynamic value) =>
    value is Map<String, dynamic> ? value : invalidResponse();
int positive(dynamic value, {bool zero = false}) =>
    value is int && value >= (zero ? 0 : 1) ? value : invalidResponse();
String label(dynamic value) =>
    value is String && value.isNotEmpty ? value : invalidResponse();
String uuid(dynamic value) =>
    value is String &&
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ).hasMatch(value)
    ? value
    : invalidResponse();
String versionId(dynamic value) =>
    value is String && RegExp(r'^[a-f0-9]{64}$').hasMatch(value)
    ? value
    : invalidResponse();

class Prize {
  final int itemId, conversionGP, ppm;
  final String name, rarity;
  final String? imageUrl;
  final bool premium;
  Prize(dynamic value) : this._(object(value));
  Prize._(Map<String, dynamic> j)
    : itemId = positive(j['itemId']),
      name = label(j['name']),
      rarity = label(j['rarity']),
      conversionGP = positive(j['conversionGP'], zero: true),
      ppm = positive(j['probabilityPpm']),
      premium = j['isPremium'] is bool
          ? j['isPremium'] as bool
          : invalidResponse(),
      imageUrl = j['imageUrl'] as String? {
    if (ppm > 1000000) invalidResponse();
  }
  String get displayGrade => GradeMapper.toUiGrade(rarity);
  String get probability =>
      '${(ppm / 10000).toStringAsFixed(4).replaceFirst(RegExp(r'\.?0+$'), '')}%';
}

class Odds {
  final int gachaId, price;
  final String version;
  final List<Prize> prizes;
  Odds(dynamic value) : this._(object(value));
  Odds._(Map<String, dynamic> j)
    : gachaId = positive(j['gachaId']),
      price = positive(j['unitPrice']),
      version = versionId(j['version']),
      prizes = (object(j['snapshot'])['entries'] as List)
          .map(Prize.new)
          .toList(growable: false) {
    final snapshot = object(j['snapshot']);
    if (j['currency'] != 'GP' ||
        snapshot['schemaVersion'] != 1 ||
        snapshot['mode'] != 'FIXED_PPM' ||
        prizes.isEmpty ||
        prizes.length > 1000 ||
        prizes.map((p) => p.itemId).toSet().length != prizes.length ||
        prizes.fold<int>(0, (s, p) => s + p.ppm) != 1000000) {
      invalidResponse();
    }
  }
}

class Capsule {
  final String id, orderId, status;
  final int sequence;
  Capsule(dynamic value) : this._(object(value));
  Capsule._(Map<String, dynamic> j)
    : id = uuid(j['id']),
      orderId = uuid(j['orderId']),
      status = label(j['status']),
      sequence = positive(j['sequence']) {
    if (!{'UNOPENED', 'OPENED'}.contains(status) || sequence > 100) {
      invalidResponse();
    }
  }
}

class Receipt {
  final String id, title, version;
  final int gachaId, quantity, unitPrice, total;
  final List<Capsule> capsules;
  Receipt(dynamic value) : this._(object(value));
  Receipt._(Map<String, dynamic> j)
    : id = uuid(j['orderId']),
      title = label(j['title']),
      version = versionId(j['probabilityVersion']),
      gachaId = positive(j['gachaId']),
      quantity = positive(j['quantity']),
      unitPrice = positive(j['unitPrice']),
      total = positive(j['total']),
      capsules = (j['capsules'] as List)
          .map(Capsule.new)
          .toList(growable: false) {
    if (j['status'] != 'PAID' ||
        j['currency'] != 'GP' ||
        quantity > 100 ||
        quantity * unitPrice != total ||
        capsules.length != quantity ||
        capsules.any((c) => c.orderId != id) ||
        capsules.map((c) => c.id).toSet().length != quantity) {
      invalidResponse();
    }
  }
}

class Opening {
  final String capsuleId;
  final int inventoryId;
  final Prize prize;
  Opening(dynamic value) : this._(object(value));
  Opening._(Map<String, dynamic> j)
    : capsuleId = uuid(j['capsuleId']),
      inventoryId = positive(j['inventoryItemId']),
      prize = Prize(j['prize']);
}

class PendingPurchase {
  final String key, title;
  final Map<String, dynamic> body;
  PendingPurchase(this.key, this.title, Map<String, dynamic> body)
    : body = Map.unmodifiable(body) {
    uuid(key);
    label(title);
    positive(body['gachaId']);
    positive(body['expectedUnitPrice']);
    versionId(body['expectedProbabilityVersion']);
    if (positive(body['quantity']) > 100) invalidResponse();
  }
  factory PendingPurchase.fromJson(dynamic value) {
    final j = object(value);
    return PendingPurchase(
      uuid(j['key']),
      label(j['title']),
      object(j['body']),
    );
  }
  Map<String, dynamic> toJson() => {'key': key, 'title': title, 'body': body};
}
