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

/// 홈의 7일 출석체크 카드: 도장 카드처럼 찍히는 7칸 + 받기 버튼.
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
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
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
                        Text(
                          '출석체크',
                          style: AppText.headline.copyWith(
                            fontWeight: FontWeight.w800,
                            color: AppColors.text,
                          ),
                        ),
                        if (status.streakDay > 0) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 3,
                            ),
                            decoration: const BoxDecoration(
                              color: AppColors.brandSoft,
                              borderRadius: Radii.pill,
                            ),
                            child: Text(
                              '${status.streakDay}일 연속',
                              style: AppText.num(AppText.micro).copyWith(
                                color: AppColors.brand,
                                fontWeight: FontWeight.w800,
                                height: 1,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      done
                          ? '내일 ${formatGp(status.tomorrowReward)}를 받을 수 있어요'
                          : '${lastDay.day}일 연속 출석하면 ${formatGp(lastDay.reward)}',
                      style: AppText.num(AppText.caption),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: Space.x2),
              if (done)
                Container(
                  height: 34,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: Radii.pill,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.check_rounded,
                        size: 15,
                        color: AppColors.success,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '오늘 완료',
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
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text('+${formatNumber(status.nextReward)} GP 받기'),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              for (var i = 0; i < status.schedule.length; i++)
                Expanded(
                  child: _DayCell(
                    day: status.schedule[i],
                    done: status.isDone(status.schedule[i].day),
                    today: status.todayDay == status.schedule[i].day,
                    isLast: i == status.schedule.length - 1,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// 도장 칸: 찍힌 날은 레드 인주 도장, 오늘은 점선 테두리, 7일째는 금박.
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
    const size = 38.0;
    final Widget stamp;
    if (done) {
      stamp = Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: AppColors.brand,
          boxShadow: Shadows.tinted(AppColors.brand, strength: 0.5),
        ),
        child: Container(
          margin: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: Colors.white.withValues(alpha: 0.55),
              width: 1,
            ),
          ),
          child: const Icon(Icons.check_rounded, size: 18, color: Colors.white),
        ),
      );
    } else {
      stamp = Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: isLast ? null : (today ? Colors.white : AppColors.surface),
          gradient: isLast
              ? const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFFFFF5CF),
                    Color(0xFFF4C54E),
                    Color(0xFFC88F17),
                  ],
                )
              : null,
          border: today ? Border.all(color: AppColors.brand, width: 1.6) : null,
        ),
        child: Text(
          formatNumber(day.reward),
          style: AppText.num(AppText.micro).copyWith(
            color: isLast
                ? const Color(0xFF5A3D00)
                : today
                ? AppColors.brand
                : AppColors.textSecondary,
            fontSize: day.reward >= 1000 ? 9.5 : 11,
            fontWeight: FontWeight.w900,
            height: 1,
          ),
        ),
      );
    }
    return Column(
      children: [
        AnimatedSwitcher(duration: Motion.normal, child: stamp),
        const SizedBox(height: 5),
        Text(
          today ? '오늘' : '${day.day}일',
          style: AppText.micro.copyWith(
            color: today ? AppColors.brand : AppColors.textSecondary,
            fontSize: 10.5,
            fontWeight: today ? FontWeight.w800 : FontWeight.w600,
            height: 1,
          ),
        ),
      ],
    );
  }
}
