import '../../../core/network/api_client.dart';
import '../../../shared/data/activity_page.dart';

enum ShippingStatus {
  requested('신청 완료'),
  shipping('배송 중'),
  delivered('배송 완료');

  final String label;
  const ShippingStatus(this.label);
}

class ShippingProduct {
  final int inventoryId;
  final String name;
  ShippingProduct(Map<String, dynamic> json)
    : inventoryId = activityInt(json['inventoryItemId'], min: 1),
      name = activityText(json['name']);
}

class ShippingRequest {
  final String id, recipient, phone, address;
  final String? notes;
  final ShippingStatus status;
  final DateTime date;
  final List<ShippingProduct> products;
  ShippingRequest.fromJson(Map<String, dynamic> json)
    : id = activityInt(json['shippingRequestId'], min: 1).toString(),
      recipient = activityText(json['recipientName']),
      phone = activityText(json['phone']),
      address = activityText(json['address']),
      notes = json['notes'] == null || json['notes'] == ''
          ? null
          : activityText(json['notes']),
      status = switch (json['status']) {
        'REQUESTED' => ShippingStatus.requested,
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
    if (items.map((e) => e.inventoryId).toSet().length != items.length)
      invalidActivity();
    return List.unmodifiable(items);
  }

  String get dateLabel => activityDateLabel(date);
}

class ShippingRepository {
  final ApiClient _api;
  const ShippingRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;
  Future<ActivityPage<ShippingRequest>> getPage({
    int page = 1,
    int limit = 20,
  }) async {
    if (page < 1 || limit < 1 || limit > 100)
      throw ArgumentError('Invalid page');
    final data = await _api.get('/shipping-requests?page=$page&limit=$limit');
    return ActivityPage.parse(
      data,
      page: page,
      limit: limit,
      parse: ShippingRequest.fromJson,
      id: (request) => request.id,
    );
  }
}
