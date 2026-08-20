import 'package:flutter/foundation.dart';

/// GP(게임 포인트) 잔액을 관리하는 Provider.
///
/// 현재는 더미 값(12,500 GP)으로 초기화되어 있으며,
/// 이후 가챠 뽑기/충전 로직과 연결될 예정입니다.
class GpProvider extends ChangeNotifier {
  int _balance;

  GpProvider({int initialBalance = 12500}) : _balance = initialBalance;

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

  void add(int amount) {
    if (amount <= 0) return;
    _balance += amount;
    notifyListeners();
  }

  /// GP 차감. 잔액 부족 시 false를 반환하고 차감하지 않음.
  bool spend(int amount) {
    if (amount <= 0) return false;
    if (_balance < amount) return false;
    _balance -= amount;
    notifyListeners();
    return true;
  }
}
