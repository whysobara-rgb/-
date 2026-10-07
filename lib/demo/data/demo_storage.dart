import 'package:shared_preferences/shared_preferences.dart';

/// 체험판 상태를 담는 저장소. 웹에서는 localStorage(shared_preferences).
abstract class DemoStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> remove(String key);
}

/// 테스트·저장소가 막힌 환경용.
class MemoryDemoStorage implements DemoStorage {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> remove(String key) async => values.remove(key);
}

/// shared_preferences에 저장한다.
///
/// 샌드박스 iframe처럼 localStorage 접근이 예외를 던지는 곳에서는 조용히
/// 메모리로 바꾼다. 그때는 새로고침하면 처음 상태로 돌아가지만 앱은 돈다.
class PrefsDemoStorage implements DemoStorage {
  PrefsDemoStorage._();

  static final PrefsDemoStorage instance = PrefsDemoStorage._();

  final Map<String, String> _memory = {};
  bool _unavailable = false;

  /// 브라우저 저장소를 못 쓰고 메모리에만 두고 있는지.
  bool get isVolatile => _unavailable;

  Future<SharedPreferences?> _prefs() async {
    if (_unavailable) return null;
    try {
      return await SharedPreferences.getInstance();
    } catch (_) {
      _unavailable = true;
      return null;
    }
  }

  @override
  Future<String?> read(String key) async {
    final prefs = await _prefs();
    if (prefs == null) return _memory[key];
    try {
      final value = prefs.getString(key);
      // 나중에 저장소가 막혀도 이번 세션에서는 읽은 값을 계속 쓴다.
      if (value != null) _memory[key] = value;
      return value ?? _memory[key];
    } catch (_) {
      return _memory[key];
    }
  }

  @override
  Future<void> write(String key, String value) async {
    _memory[key] = value;
    final prefs = await _prefs();
    if (prefs == null) return;
    try {
      await prefs.setString(key, value);
    } catch (_) {
      // 용량 초과·접근 거부: 메모리 값으로 계속한다.
      _unavailable = true;
    }
  }

  @override
  Future<void> remove(String key) async {
    _memory.remove(key);
    final prefs = await _prefs();
    if (prefs == null) return;
    try {
      await prefs.remove(key);
    } catch (_) {
      _unavailable = true;
    }
  }
}
