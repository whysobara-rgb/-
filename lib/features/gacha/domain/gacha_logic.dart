import '../../../core/network/api_client.dart';
import 'draw_result.dart';

/// 가치가차 - 뽑기(가챠) API 연동 로직.
///
/// 백엔드 `POST /draws`를 호출해 실제 뽑기를 수행하고, 응답의
/// results[] 배열을 [DrawResult] 리스트로 변환해 반환한다.
/// 잔액 부족/가차 없음 등의 오류는 [ApiException]으로 그대로 전파되므로
/// 호출부에서 try/catch로 처리해야 한다.
Future<List<DrawResult>> drawGacha(
  int gachaId,
  int count, {
  ApiClient apiClient = const ApiClient(),
}) async {
  final data = await apiClient.post(
    '/draws',
    body: {'gachaId': gachaId, 'count': count},
  );
  final map = data as Map<String, dynamic>;
  final results = map['results'] as List<dynamic>;
  return results
      .map((e) => DrawResult.fromJson(e as Map<String, dynamic>))
      .toList();
}
