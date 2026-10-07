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
    if (_loading) return const SizedBox(height: 196);
    if (_failed || status == null || status.schedule.isEmpty) {
      // 구버전 서버 등 출석 API가 없으면 카드를 감춘다.
      return const SizedBox.shrink();
    }

    final lastDay = status.schedule.last;
    return Container(
      padding: const EdgeInsets.fromLTRB(
        Space.x4,
        Space.x4,
        Space.x4,
        Space.x4,
      ),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.line),
        borderRadius: Radii.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('출석체크', style: AppText.headline),
                    const SizedBox(height: 2),
                    Text(
                      '${lastDay.day}일 연속 출석하면 ${formatGp(lastDay.reward)}',
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
              if (status.streakDay > 0)
                Text(
                  '${status.streakDay}일 연속',
                  style: AppText.num(
                    AppText.caption,
                  ).copyWith(color: AppColors.ink, fontWeight: FontWeight.w700),
                ),
            ],
          ),
          const SizedBox(height: Space.x4),
          Row(
            children: [
              for (var i = 0; i < status.schedule.length; i++) ...[
                if (i > 0) const SizedBox(width: 6),
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
          const SizedBox(height: Space.x4),
          if (status.checkedInToday)
            Container(
              height: 44,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                color: AppColors.bgSubtle,
                borderRadius: Radii.button,
              ),
              child: Text(
                '오늘 출석 완료 · 내일 ${formatGp(status.tomorrowReward)}',
                style: AppText.num(AppText.callout),
              ),
            )
          else
            SizedBox(
              height: 44,
              child: FilledButton(
                onPressed: _submitting ? null : _checkIn,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(44),
                  textStyle: AppText.bodyStrong,
                ),
                child: _submitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text('출석하고 ${formatGp(status.nextReward)} 받기'),
              ),
            ),
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
      bg = AppColors.ink;
      fg = AppColors.onInk;
    } else if (today) {
      bg = AppColors.accentTint;
      fg = AppColors.accent;
      border = Border.all(color: AppColors.accent, width: 1.2);
    } else {
      bg = AppColors.bgSubtle;
      fg = AppColors.inkSecondary;
    }

    return AnimatedContainer(
      duration: Motion.normal,
      height: 56,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: Radii.button,
        border: border,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          done
              ? Icon(Icons.check, size: 14, color: fg)
              : Text(
                  today ? '오늘' : '${day.day}일',
                  style: AppText.micro.copyWith(color: fg, height: 1.1),
                ),
          const SizedBox(height: 4),
          Text(
            formatNumber(day.reward),
            style: AppText.num(AppText.caption).copyWith(
              color: fg,
              fontWeight: isLast ? FontWeight.w800 : FontWeight.w600,
              height: 1.1,
            ),
          ),
        ],
      ),
    );
  }
}
