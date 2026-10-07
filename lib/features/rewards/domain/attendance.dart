import '../../../core/utils/format.dart';

class AttendanceDay {
  final int day;
  final int reward;
  const AttendanceDay(this.day, this.reward);
}

/// `GET /rewards/attendance`.
class AttendanceStatus {
  final String today;
  final bool checkedInToday;

  /// 오늘까지 이어진 연속 출석 일수(오늘 출석 전이면 어제까지).
  final int streakDay;

  /// 오늘 출석하면 몇 일차가 되는지.
  final int nextStreakDay;

  /// 다음 출석 보상 GP.
  final int nextReward;
  final List<AttendanceDay> schedule;

  const AttendanceStatus({
    required this.today,
    required this.checkedInToday,
    required this.streakDay,
    required this.nextStreakDay,
    required this.nextReward,
    required this.schedule,
  });

  factory AttendanceStatus.fromJson(Map<String, dynamic> json) {
    final schedule =
        asMapList(json['schedule'])
            .map((m) => AttendanceDay(asInt(m['day']), asInt(m['reward'])))
            .toList()
          ..sort((a, b) => a.day.compareTo(b.day));
    return AttendanceStatus(
      today: asStringOrNull(json['today']) ?? '',
      checkedInToday: asBool(json['checkedInToday']),
      streakDay: asInt(json['streakDay']),
      nextStreakDay: asInt(json['nextStreakDay'], 1),
      nextReward: asInt(json['nextReward']),
      schedule: schedule,
    );
  }

  /// 칸 [day]가 이미 채워졌는지.
  bool isDone(int day) =>
      checkedInToday ? day <= streakDay : day < nextStreakDay;

  /// 오늘 출석하면 채워질 칸(이미 했으면 오늘 채운 칸).
  int get todayDay => checkedInToday ? streakDay : nextStreakDay;

  int rewardFor(int day) => schedule
      .firstWhere((d) => d.day == day, orElse: () => const AttendanceDay(0, 0))
      .reward;

  /// 오늘 출석했을 때 내일 받는 보상.
  int get tomorrowReward {
    if (schedule.isEmpty) return 0;
    final next = streakDay % schedule.length + 1;
    return rewardFor(next);
  }
}

/// `POST /rewards/attendance`.
class CheckInResult {
  final int streakDay;
  final int reward;
  final int? balanceAfter;

  const CheckInResult({
    required this.streakDay,
    required this.reward,
    required this.balanceAfter,
  });

  factory CheckInResult.fromJson(Map<String, dynamic> json) => CheckInResult(
    streakDay: asInt(json['streakDay']),
    reward: asInt(json['reward']),
    balanceAfter: asIntOrNull(json['balanceAfter']),
  );
}
