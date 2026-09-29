// Shared catalog data only. Never imported by application lib/.
import 'dart:convert';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import 'package:gacha_vault/features/orders/batch_opening.dart';
import '../v33_stage2/fixtures.dart';
import 'fixture_data.dart';

final _data = jsonDecode(unifiedFixtureJson) as Map<String, dynamic>;

Map<String, dynamic> reviewReceiptData({int quantity = 3}) => {
  'orderId': capsuleId(800),
  'title': _data['boxes'][0]['title'],
  'gachaId': _data['odds']['gachaId'],
  'quantity': quantity,
  'unitPrice': _data['odds']['unitPrice'],
  'total': _data['odds']['unitPrice'] * quantity,
  'currency': 'GP',
  'status': 'PAID',
  'probabilityVersion': _data['odds']['version'],
  'capsules': List.generate(
    quantity,
    (i) => {
      'id': capsuleId(i + 1),
      'orderId': capsuleId(800),
      'sequence': i + 1,
      'status': 'UNOPENED',
    },
  ),
};
Receipt reviewReceipt({int quantity = 3}) =>
    Receipt(reviewReceiptData(quantity: quantity));

BatchOpening reviewBatch({
  int completed = 3,
  int total = 3,
  bool pending = false,
}) {
  final prizes = _data['odds']['snapshot']['entries'] as List;
  return BatchOpening(
    id: capsuleId(900),
    capsuleIds: List.generate(total, (i) => capsuleId(i + 1)),
    results: List.generate(
      completed,
      (i) => Opening({
        'capsuleId': capsuleId(i + 1),
        'inventoryItemId': i + 1,
        'prize': prizes[i % prizes.length],
      }),
    ),
    inFlight: pending ? capsuleId(completed + 1) : null,
  );
}

OrderRepository reviewOrderRepository() => fixtureRepository((r) async {
  if (r.method != 'GET') {
    throw StateError('Read-only catalog: mutation prohibited');
  }
  if (r.url.path == '/capsules') {
    return fixtureOk({
      'items': reviewReceiptData()['capsules'],
      'totalCount': 3,
      'page': 1,
      'limit': 20,
    });
  }
  if (r.url.path == '/gachas/${_data['odds']['gachaId']}/odds') {
    return fixtureOk(_data['odds']);
  }
  if (r.url.path == '/orders/${capsuleId(800)}') {
    return fixtureOk(reviewReceiptData());
  }
  throw StateError('Unmapped read-only catalog route');
});

List<InventoryItem> reviewInventory() => reviewBatch().results
    .map(
      (r) => InventoryItem.fromJson({
        ...Map<String, dynamic>.from(
          (_data['odds']['snapshot']['entries'] as List).singleWhere(
            (p) => p['itemId'] == r.prize.itemId,
          ),
        ),
        'inventoryItemId': r.inventoryId,
        'status': 'STORED',
        'acquiredAt': '2026-09-29T00:00:00Z',
      }),
    )
    .toList();
