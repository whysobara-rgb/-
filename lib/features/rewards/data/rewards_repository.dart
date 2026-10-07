import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../domain/attendance.dart';

class RewardsRepository {
  final ApiClient _api;
  const RewardsRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  Future<AttendanceStatus> attendance() async =>
      AttendanceStatus.fromJson(asMap(await _api.get('/rewards/attendance')));

  /// 이미 출석했으면 statusCode 10008 [ApiException].
  Future<CheckInResult> checkIn() async =>
      CheckInResult.fromJson(asMap(await _api.post('/rewards/attendance')));
}
