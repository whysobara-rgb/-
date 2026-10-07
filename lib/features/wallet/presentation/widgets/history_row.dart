import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../domain/point_history.dart';

/// GP 내역 한 줄: 사유 아이콘 · 사유/설명 · 일시 · 금액(잔액).
class HistoryRow extends StatelessWidget {
  final PointHistoryEntry entry;
  const HistoryRow({super.key, required this.entry});

  @override
  Widget build(BuildContext context) {
    final positive = entry.signedAmount > 0;
    final sub = [
      formatDateTime(entry.date),
      if (entry.detail != null) entry.detail!,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Space.gutter,
        vertical: 14,
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(
              color: AppColors.bgSubtle,
              shape: BoxShape.circle,
            ),
            child: Icon(entry.reason.icon, size: 20, color: AppColors.ink),
          ),
          const SizedBox(width: Space.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(entry.title, style: AppText.bodyStrong),
                const SizedBox(height: 2),
                Text(
                  sub,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.num(AppText.caption),
                ),
              ],
            ),
          ),
          const SizedBox(width: Space.x2),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                formatSignedGp(entry.signedAmount),
                style: AppText.num(AppText.bodyStrong).copyWith(
                  color: positive ? AppColors.positive : AppColors.ink,
                ),
              ),
              if (entry.balanceAfter != null) ...[
                const SizedBox(height: 2),
                Text(
                  formatGp(entry.balanceAfter!),
                  style: AppText.num(
                    AppText.caption,
                  ).copyWith(color: AppColors.inkTertiary),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
