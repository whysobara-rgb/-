import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/widgets/ui.dart';
import '../data/rewards_repository.dart';
import '../domain/attendance.dart';

/// 홈의 7일 출석체크 카드.
class AttendanceCard extends StatefulWidget {
  /// 값이 바뀌면 다시 불러온다(탭 재진입·당겨서 새로고침).
  final int refreshToken;

  const AttendanceCard({super.key, this.refreshToken = 0});

  @override
  State<AttendanceCard> createState() => _AttendanceCardState();
}

class _AttendanceCardState extends State<AttendanceCard> {
  static const _repository = RewardsRepository();

  AttendanceStatus? _status;
  bool _loading = true;
  bool _submitting = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant AttendanceCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshToken != widget.refreshToken) _load();
  }

  Future<void> _load() async {
    try {
      final status = await _repository.attendance();
      if (!mounted) return;
      setState(() {
        _status = status;
        _loading = false;
        _failed = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  Future<void> _checkIn() async {
    setState(() => _submitting = true);
    try {
      final result = await _repository.checkIn();
      if (!mounted) return;
      if (result.balanceAfter != null) {
        context.read<AuthProvider>().applyBalance(result.balanceAfter!);
      }
      showToast(
        context,
        '${result.streakDay}일째 출석 · ${formatGp(result.reward)}를 받았어요',
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      showToast(
        context,
        e.statusCode == ApiCode.alreadyCheckedIn
            ? '오늘은 이미 출석했어요'
            : e.displayMessage,
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    if (_loading) return const SizedBox(height: 150);
    if (_failed || status == null || status.schedule.isEmpty) {
      // 구버전 서버 등 출석 API가 없으면 카드를 감춘다.
      return const SizedBox.shrink();
    }

    final lastDay = status.schedule.last;
    final done = status.checkedInToday;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: Radii.card,
        border: Border.all(
          color: done
              ? AppColors.hairline
              : AppColors.brand.withValues(alpha: 0.35),
        ),
        gradient: done
            ? null
            : LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.brand.withValues(alpha: 0.10),
                  AppColors.surface,
                ],
                stops: const [0, 0.6],
              ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text('출석체크', style: AppText.headline),
                        if (status.streakDay > 0) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.high,
                              borderRadius: Radii.chip,
                            ),
                            child: Text(
                              '${status.streakDay}일 연속',
                              style: AppText.num(AppText.micro).copyWith(
                                color: AppColors.text,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${lastDay.day}일 연속 출석하면 ${formatGp(lastDay.reward)}',
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: Space.x2),
              if (done)
                Container(
                  height: 36,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.high,
                    borderRadius: Radii.pill,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.check_rounded,
                        size: 15,
                        color: AppColors.brand,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '완료',
                        style: AppText.caption.copyWith(
                          color: AppColors.text,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                )
              else
                SizedBox(
                  height: 36,
                  child: FilledButton(
                    onPressed: _submitting ? null : _checkIn,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 36),
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      shape: const StadiumBorder(),
                      textStyle: AppText.bodyStrong.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    child: _submitting
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text('+${formatNumber(status.nextReward)} GP 받기'),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              for (var i = 0; i < status.schedule.length; i++) ...[
                if (i > 0) const SizedBox(width: 5),
                Expanded(
                  child: _DayCell(
                    day: status.schedule[i],
                    done: status.isDone(status.schedule[i].day),
                    today: status.todayDay == status.schedule[i].day,
                    isLast: i == status.schedule.length - 1,
                  ),
                ),
              ],
            ],
          ),
          if (done) ...[
            const SizedBox(height: 10),
            Text(
              '내일 ${formatGp(status.tomorrowReward)}를 받을 수 있어요',
              style: AppText.num(AppText.caption),
            ),
          ],
        ],
      ),
    );
  }
}

class _DayCell extends StatelessWidget {
  final AttendanceDay day;
  final bool done;
  final bool today;
  final bool isLast;

  const _DayCell({
    required this.day,
    required this.done,
    required this.today,
    required this.isLast,
  });

  @override
  Widget build(BuildContext context) {
    final Color bg;
    final Color fg;
    BoxBorder? border;
    if (done) {
      bg = AppColors.brand.withValues(alpha: 0.16);
      fg = AppColors.brand;
    } else if (today) {
      bg = AppColors.raised;
      fg = AppColors.text;
      border = Border.all(color: AppColors.brand, width: 1.2);
    } else if (isLast) {
      bg = AppColors.raritySSR.withValues(alpha: 0.10);
      fg = AppColors.raritySSRLight;
      border = Border.all(color: AppColors.raritySSR.withValues(alpha: 0.35));
    } else {
      bg = AppColors.raised;
      fg = AppColors.textSecondary;
    }

    return AnimatedContainer(
      duration: Motion.normal,
      height: 50,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: Radii.button,
        border: border,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          done
              ? Icon(Icons.check_rounded, size: 14, color: fg)
              : Text(
                  today ? '오늘' : '${day.day}일',
                  style: AppText.micro.copyWith(
                    color: fg,
                    fontSize: 10,
                    height: 1.1,
                  ),
                ),
          const SizedBox(height: 3),
          Text(
            formatNumber(day.reward),
            style: AppText.num(AppText.caption).copyWith(
              color: fg,
              fontSize: 11.5,
              fontWeight: isLast ? FontWeight.w900 : FontWeight.w700,
              height: 1.1,
            ),
          ),
        ],
      ),
    );
  }
}
