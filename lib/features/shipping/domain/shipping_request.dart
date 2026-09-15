import '../../../core/network/api_client.dart';
import '../../orders/order_models.dart' show object, uuid;
import '../../../shared/data/activity_page.dart';

enum ShippingStatus {
  requested('신청 완료'),
  preparing('배송 준비'),
  collected('택배사 인계'),
  shipping('배송 중'),
  delivered('배송 완료'),
  cancelled('신청 취소');

  final String label;
  const ShippingStatus(this.label);
}

class ShippingProduct {
  final int inventoryId;
  final String name;
  ShippingProduct(Map<String, dynamic> json)
    : inventoryId = activityInt(json['inventoryItemId'], min: 1),
      name = activityText(object(json['prize'])['name']);
}

class ShippingRequest {
  final String id, recipient, phone, address, postalCode;
  final String? notes, carrier, trackingNumber;
  final int feeGP;
  final ShippingStatus status;
  final DateTime date;
  final List<ShippingProduct> products;
  ShippingRequest.fromJson(Map<String, dynamic> json)
    : id = uuid(json['fulfillmentId']),
      recipient = activityText(object(json['recipient'])['name']),
      phone = activityText(object(json['recipient'])['phone']),
      postalCode = activityText(object(json['recipient'])['postalCode']),
      address =
          '${activityText(object(json['recipient'])['address1'])} ${object(json['recipient'])['address2'] ?? ''}'
              .trim(),
      notes = object(json['recipient'])['notes'] as String?,
      carrier = json['carrier'] as String?,
      trackingNumber = json['trackingNumber'] as String?,
      feeGP = activityInt(json['feeGP']),
      status = switch (json['status']) {
        'REQUESTED' => ShippingStatus.requested,
        'PREPARING' => ShippingStatus.preparing,
        'COLLECTED' => ShippingStatus.collected,
        'CANCELLED' => ShippingStatus.cancelled,
        'SHIPPING' => ShippingStatus.shipping,
        'DELIVERED' => ShippingStatus.delivered,
        _ => invalidActivity(),
      },
      date = activityDate(json['createdAt']),
      products = _products(json['items']);
  static List<ShippingProduct> _products(dynamic raw) {
    if (raw is! List || raw.isEmpty) invalidActivity();
    final items = raw
        .map(
          (e) => e is Map<String, dynamic>
              ? ShippingProduct(e)
              : invalidActivity(),
        )
        .toList();
    if (items.map((e) => e.inventoryId).toSet().length != items.length) {
      invalidActivity();
    }
    return List.unmodifiable(items);
  }

  String get dateLabel => activityDateLabel(date);
}

class ShippingRepository {
  final ApiClient _api;
  const ShippingRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;
  Future<ShippingRequest> getOne(String id) async {
    final result = ShippingRequest.fromJson(
      object(await _api.get('/fulfillments/${uuid(id)}')),
    );
    if (result.id != id) invalidActivity();
    return result;
  }

  Future<ActivityPage<ShippingRequest>> getPage({
    int page = 1,
    int limit = 20,
  }) async {
    if (page < 1 || limit < 1 || limit > 100) {
      throw ArgumentError('Invalid page');
    }
    final data = await _api.get('/fulfillments?page=$page&limit=$limit');
    return ActivityPage.parse(
      data,
      page: page,
      limit: limit,
      parse: ShippingRequest.fromJson,
      id: (request) => request.id,
    );
  }
}
