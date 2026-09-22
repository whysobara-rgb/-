import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/data/activity_page.dart';

enum PointHistoryType { earn, use, expire }

extension PointHistoryTypeLabel on PointHistoryType {
  String get label => switch (this) {
    PointHistoryType.earn => '지급',
    PointHistoryType.use => '사용',
    PointHistoryType.expire => '소멸',
  };
  Color get amountColor => switch (this) {
    PointHistoryType.earn => AppColors.accentViolet,
    PointHistoryType.use => AppColors.error,
    PointHistoryType.expire => AppColors.textSecondary,
  };
  String get sign => this == PointHistoryType.earn ? '+' : '-';
  String get backendType => name.toUpperCase();
}

class PointHistoryEntry {
  final String id, description;
  final PointHistoryType type;
  final int amount;
  final DateTime date;
  const PointHistoryEntry({
    required this.id,
    required this.description,
    required this.type,
    required this.amount,
    required this.date,
  });

  factory PointHistoryEntry.fromJson(Map<String, dynamic> json) {
    final type = switch (json['type']) {
      'EARN' => PointHistoryType.earn,
      'USE' => PointHistoryType.use,
      'EXPIRE' => PointHistoryType.expire,
      _ => invalidActivity(),
    };
    final raw = json['amount'];
    if (raw is! int ||
        raw.abs() > 9007199254740991 ||
        (type == PointHistoryType.earn ? raw < 0 : raw > 0)) {
      invalidActivity();
    }
    return PointHistoryEntry(
      id: activityInt(json['id'], min: 1).toString(),
      description: activityText(json['description']),
      type: type,
      amount: raw.abs(),
      date: activityDate(json['createdAt']),
    );
  }
  String get formattedAmount =>
      '${type.sign}${amount.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')} GP';
  String get formattedDate => activityDateLabel(date);
}

class PointHistoryRepository {
  final ApiClient _apiClient;
  const PointHistoryRepository({ApiClient apiClient = const ApiClient()})
    : _apiClient = apiClient;

  Future<ActivityPage<PointHistoryEntry>> getPage({
    int page = 1,
    int limit = 20,
    PointHistoryType? type,
  }) async {
    if (page < 1 || limit < 1 || limit > 100) {
      throw ArgumentError('Invalid page');
    }
    final data = await _apiClient.get(
      '/wallet/point-history?page=$page&limit=$limit'
      '${type == null ? '' : '&type=${type.backendType}'}',
    );
    return ActivityPage.parse(
      data,
      page: page,
      limit: limit,
      parse: PointHistoryEntry.fromJson,
      id: (entry) => entry.id,
    );
  }

  /// Bounded recent-activity preview; full history uses getPage.
  Future<List<PointHistoryEntry>> getAll({
    PointHistoryType? type,
    int limit = 100,
  }) async => (await getPage(type: type, limit: limit)).items;
}
