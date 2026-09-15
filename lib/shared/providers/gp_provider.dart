import 'package:flutter/foundation.dart';
import '../models/app_user.dart';

/// GP(GACHA POINT) 잔액을 관리하는 Provider.
///
/// 실제 잔액은 백엔드(User.coinBalance)에서 관리되며, 이 Provider는
/// [syncFromUser]를 통해 [AuthProvider]의 currentUser가 바뀔 때마다
/// (로그인/로그아웃/새로고침) 최신 값을 반영하는 "표시용 캐시" 역할을 한다.
///
/// 뽑기/충전/배송 등으로 서버 잔액이 바뀐 뒤에는 반드시 서버 재조회
/// (AuthProvider.refreshProfile() 등)를 통해 [syncFromUser]가 다시
/// 호출되도록 해야 한다. 앱에서 잔액을 임의 가감하는 메서드는 제공하지 않는다.
class GpProvider extends ChangeNotifier {
  int _balance;
  bool _isStale = false;
  bool get isStale => _isStale;

  GpProvider({int initialBalance = 0}) : _balance = initialBalance;

  int get balance => _balance;

  /// 화면 표시용 3자리 콤마 포맷 (예: 12,500)
  String get formattedBalance {
    final str = _balance.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) {
        buffer.write(',');
      }
    }
    return buffer.toString();
  }

  /// [AuthProvider]의 currentUser 변경에 맞춰 잔액을 동기화한다.
  /// 로그아웃(user == null) 시 0으로 초기화된다.
  void syncFromUser(AppUser? user, {bool stale = false}) {
    final newBalance = user?.coinBalance ?? 0;
    final newStale = user != null && stale;
    if (newBalance != _balance || newStale != _isStale) {
      _isStale = newStale;
      _balance = newBalance;
      notifyListeners();
    }
  }
}
