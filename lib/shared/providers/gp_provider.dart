import 'package:flutter/foundation.dart';
import '../../core/utils/format.dart';
import '../models/app_user.dart';

/// 보유 GP 표시용 캐시.
///
/// 실제 잔액은 서버(User.coinBalance)가 기준이다. [syncFromUser]로
/// 로그인 사용자 정보와 맞추고, 뽑기·전환·출석처럼 응답에 `balanceAfter`가
/// 오는 경우 [setBalance]로 즉시 반영한다.
class GpProvider extends ChangeNotifier {
  int _balance;

  GpProvider({int initialBalance = 0}) : _balance = initialBalance;

  int get balance => _balance;

  String get formattedBalance => formatNumber(_balance);

  void syncFromUser(AppUser? user) => setBalance(user?.coinBalance ?? 0);

  /// 서버 응답의 `balanceAfter`를 그대로 반영한다.
  void setBalance(int value) {
    if (value == _balance) return;
    _balance = value;
    notifyListeners();
  }
}
