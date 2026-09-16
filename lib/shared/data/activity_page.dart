import '../../core/network/api_client.dart';

Never invalidActivity() => throw ApiException(
  statusCode: 0,
  message: '내역을 확인하지 못했습니다. 새로고침 후 다시 확인해주세요',
);

int activityInt(dynamic value, {int min = 0}) =>
    value is int && value >= min && value <= 9007199254740991
    ? value
    : invalidActivity();

String activityText(dynamic value) =>
    value is String && value.trim().isNotEmpty ? value : invalidActivity();

DateTime activityDate(dynamic value) {
  final date = value is String ? DateTime.tryParse(value) : null;
  return date?.toLocal() ?? invalidActivity();
}

String activityDateLabel(DateTime date) =>
    '${date.year}.${date.month.toString().padLeft(2, '0')}.${date.day.toString().padLeft(2, '0')}';

class ActivityPage<T> {
  final List<T> items;
  final int page, limit, total;
  ActivityPage({
    required List<T> items,
    required this.page,
    required this.limit,
    required this.total,
  }) : items = List.unmodifiable(items);
  bool get hasMore => page * limit < total;

  factory ActivityPage.parse(
    dynamic data, {
    required int page,
    required int limit,
    required T Function(Map<String, dynamic>) parse,
    required String Function(T) id,
  }) {
    if (data is! Map<String, dynamic> ||
        data['page'] != page ||
        data['limit'] != limit ||
        data['items'] is! List) {
      invalidActivity();
    }
    final total = activityInt(data['totalCount']);
    final raw = data['items'] as List;
    final remaining = (total - (page - 1) * limit).clamp(0, limit);
    if (raw.length != remaining) invalidActivity();
    final items = raw
        .map((e) => e is Map<String, dynamic> ? parse(e) : invalidActivity())
        .toList();
    if (items.map(id).toSet().length != items.length) invalidActivity();
    return ActivityPage(items: items, page: page, limit: limit, total: total);
  }
}
