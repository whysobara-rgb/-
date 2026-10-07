import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/domain/rarity.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/rarity_tag.dart';
import '../../../ranking/domain/ranking_models.dart';

/// 최근 SR/SSR 당첨 한 줄 티커(`GET /rankings/wins`).
///
/// 서버 기록 그대로(닉네임 마스킹도 서버), 실제 경과 시간과 함께 보여준다.
/// SR 이상 기록이 없으면 부모가 아예 그리지 않는다.
class WinTicker extends StatefulWidget {
  final List<WinFeedItem> wins;
  final VoidCallback? onTap;

  const WinTicker({super.key, required this.wins, this.onTap});

  /// 티커에 올릴 기록만 고른다(SR 이상).
  static List<WinFeedItem> pick(List<WinFeedItem> all) =>
      all.where((w) => w.rarity.isFoil).toList();

  @override
  State<WinTicker> createState() => _WinTickerState();
}

class _WinTickerState extends State<WinTicker> {
  Timer? _timer;
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _restart();
  }

  @override
  void didUpdateWidget(covariant WinTicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.wins.length != widget.wins.length) {
      _index = 0;
      _restart();
    }
  }

  void _restart() {
    _timer?.cancel();
    if (widget.wins.length < 2) return;
    _timer = Timer.periodic(const Duration(milliseconds: 3200), (_) {
      if (mounted) setState(() => _index = (_index + 1) % widget.wins.length);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.wins.isEmpty) return const SizedBox.shrink();
    final w = widget.wins[_index % widget.wins.length];
    return Padding(
      padding: Space.page,
      child: InkWell(
        onTap: widget.onTap,
        borderRadius: Radii.button,
        child: Container(
          height: 44,
          padding: const EdgeInsets.only(left: 12, right: 12),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: Radii.button,
            border: Border.all(color: w.rarity.color.withValues(alpha: 0.28)),
            gradient: LinearGradient(
              colors: [
                w.rarity.color.withValues(alpha: 0.12),
                AppColors.surface,
              ],
              stops: const [0, 0.45],
            ),
          ),
          child: Row(
            children: [
              Text(
                '최근 당첨',
                style: AppText.micro.copyWith(
                  color: AppColors.text,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Container(
                width: 1,
                height: 12,
                margin: const EdgeInsets.symmetric(horizontal: 10),
                color: AppColors.hairlineStrong,
              ),
              Expanded(
                child: ClipRect(
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 420),
                    switchInCurve: Curves.easeOutCubic,
                    switchOutCurve: Curves.easeInCubic,
                    transitionBuilder: (child, anim) {
                      final incoming = child.key == ValueKey(w.inventoryItemId);
                      return SlideTransition(
                        position: Tween(
                          begin: Offset(0, incoming ? 1 : -1),
                          end: Offset.zero,
                        ).animate(anim),
                        child: FadeTransition(opacity: anim, child: child),
                      );
                    },
                    child: _Line(key: ValueKey(w.inventoryItemId), win: w),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  final WinFeedItem win;
  const _Line({super.key, required this.win});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        RarityTag(win.rarity, dense: true, holo: win.rarity == Rarity.ssr),
        const SizedBox(width: 8),
        Expanded(
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: '${win.nickname}님 ',
                  style: const TextStyle(color: AppColors.textSecondary),
                ),
                TextSpan(
                  text: win.itemName,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                TextSpan(
                  text: ' ${formatWonShort(win.estimatedValue)}',
                  style: TextStyle(color: win.rarity.light),
                ),
              ],
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.caption.copyWith(color: AppColors.text),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          win.relativeTimeLabel,
          style: AppText.micro.copyWith(color: AppColors.textTertiary),
        ),
      ],
    );
  }
}
