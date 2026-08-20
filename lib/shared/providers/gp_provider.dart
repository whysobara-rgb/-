import 'package:flutter/foundation.dart';
import '../models/app_user.dart';

/// GP(게임 포인트) 잔액을 관리하는 Provider.
///
/// 실제 잔액은 백엔드(User.coinBalance)에서 관리되며, 이 Provider는
/// [syncFromUser]를 통해 [AuthProvider]의 currentUser가 바뀔 때마다
/// (로그인/로그아웃/새로고침) 최신 값을 반영하는 "표시용 캐시" 역할을 한다.
///
/// 뽑기/충전/배송 등으로 서버 잔액이 바뀐 뒤에는 반드시 서버 재조회
/// (AuthProvider.refreshProfile() 등)를 통해 [syncFromUser]가 다시
/// 호출되도록 해야 한다. [spend]/[add]는 응답 대기 중 UI를 낙관적으로
/// 갱신하기 위한 보조 메서드로, 이후 서버 값으로 덮어써진다.
class GpProvider extends ChangeNotifier {
  int _balance;

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
  void syncFromUser(AppUser? user) {
    final newBalance = user?.coinBalance ?? 0;
    if (newBalance != _balance) {
      _balance = newBalance;
      notifyListeners();
    }
  }

  /// 서버 응답을 받기 전까지의 낙관적(optimistic) 잔액 증가.
  void add(int amount) {
    if (amount <= 0) return;
    _balance += amount;
    notifyListeners();
  }

  /// 서버 응답을 받기 전까지의 낙관적(optimistic) 잔액 차감.
  /// 잔액 부족 시 false를 반환하고 차감하지 않음.
  bool spend(int amount) {
    if (amount <= 0) return false;
    if (_balance < amount) return false;
    _balance -= amount;
    notifyListeners();
    return true;
  }
}
