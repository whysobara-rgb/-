import '../../core/network/api_client.dart';
import '../account_security/account_security_repository.dart';

enum RecoveryPurpose { reset, verify }

const recoveryAcceptedMessage =
    '요청이 접수됐습니다. 가입된 이메일이라면 안내 메일을 보내드립니다. 받은편지함과 스팸함을 확인해주세요. 실제 발송 여부는 아직 확인되지 않았습니다.';

Never recoveryInvalid() => throw const FormatException('RECOVERY_RESPONSE_INVALID');
Map<String, dynamic> recoveryObject(dynamic value) =>
    value is Map<String, dynamic> ? value : recoveryInvalid();

class RecoveryCapabilities {
  final bool enabled;
  final int resetMinutes, verificationMinutes;
  RecoveryCapabilities(dynamic value) : this._(recoveryObject(value));
  RecoveryCapabilities._(Map<String, dynamic> j)
      : enabled = j['enabled'] is bool ? j['enabled'] : recoveryInvalid(),
        resetMinutes = _minutes(j['resetMinutes']),
        verificationMinutes = _minutes(j['verificationMinutes']) {
    if (j['contract'] != 'ACCOUNT_RECOVERY_V1' || j['delivery'] != 'EMAIL' ||
        j['identityVerificationEnabled'] != false) { recoveryInvalid(); }
  }
  static int _minutes(dynamic v) =>
      v is int && v > 0 && v <= 1440 ? v : recoveryInvalid();
}

class EmailVerificationStatus {
  final String email;
  final bool verified;
  final DateTime? verifiedAt;
  EmailVerificationStatus(dynamic value) : this._(recoveryObject(value));
  EmailVerificationStatus._(Map<String, dynamic> j)
      : email = j['email'] is String && recoveryEmailError(j['email']) == null
            ? j['email'] : recoveryInvalid(),
        verified = j['verified'] is bool ? j['verified'] : recoveryInvalid(),
        verifiedAt = j['verifiedAt'] == null ? null : _date(j['verifiedAt']) {
    if (verified != (verifiedAt != null)) { recoveryInvalid(); }
  }
  static DateTime _date(dynamic value) {
    if (value is! String || !RegExp(
      r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$').hasMatch(value)) {
      recoveryInvalid();
    }
    return DateTime.tryParse(value) ?? recoveryInvalid();
  }
}

String? recoveryEmailError(String value) {
  final s = value.trim();
  if (s.isEmpty || s.length > 255 || !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(s) ||
      RegExp(r'[\x00-\x1f\x7f]').hasMatch(s)) {
    return '가입한 이메일 주소를 확인해주세요';
  }
  return null;
}

/// Origin is public build configuration, never derived from an untrusted link.
/// This manual-paste adapter neither opens the URL nor reads the clipboard.
class RecoveryRepository {
  final ApiClient api;
  final String webOrigin;
  const RecoveryRepository({this.api = const ApiClient(),
    this.webOrigin = const String.fromEnvironment('AUTH_PUBLIC_WEB_ORIGIN')});

  String? get trustedOrigin {
    final u = Uri.tryParse(webOrigin);
    if (u == null || u.scheme != 'https' || u.host.isEmpty ||
        u.userInfo.isNotEmpty || u.hasQuery || u.hasFragment ||
        !(u.path.isEmpty || u.path == '/') ||
        webOrigin != u.origin && webOrigin != '${u.origin}/') { return null; }
    return u.origin;
  }

  String tokenFromLink(String input, RecoveryPurpose purpose) {
    final origin = trustedOrigin;
    if (origin == null || input.length > 2048) {
      throw const FormatException('RECOVERY_LINK_INVALID');
    }
    final match = RegExp('^${RegExp.escape(origin)}/#auth-${purpose.name}/([a-f0-9]{64})\$')
        .firstMatch(input.trim());
    if (match == null) { throw const FormatException('RECOVERY_LINK_INVALID'); }
    return match.group(1)!;
  }

  Future<RecoveryCapabilities> capabilities(bool Function() current) async =>
      RecoveryCapabilities(await api.getForSession('/auth/recovery/capabilities',
        withAuth: false, sessionIsCurrent: current));

  Future<void> _gate(bool Function() current) async {
    if (!(await capabilities(current)).enabled) {
      throw ApiException(statusCode: 0, httpStatusCode: 503,
        message: '이메일 인증·계정 복구 서비스 연결을 준비하고 있습니다');
    }
  }

  Future<void> requestReset(String email, bool Function() current) async {
    if (recoveryEmailError(email) != null) { throw const FormatException('RECOVERY_EMAIL_INVALID'); }
    await _gate(current);
    _accepted(await api.postForSession('/auth/recovery/request', withAuth: false,
      sessionIsCurrent: current, body: {'email': email.trim()}));
  }

  Future<EmailVerificationStatus> emailStatus(String expectedEmail, bool Function() current) async {
    final s = EmailVerificationStatus(await api.getForSession('/account/email', sessionIsCurrent: current));
    if (s.email != expectedEmail) { recoveryInvalid(); }
    return s;
  }

  Future<void> requestVerification(bool Function() current) async {
    await _gate(current);
    _accepted(await api.postForSession('/account/email/request', body: {}, sessionIsCurrent: current));
  }

  void _accepted(dynamic value) {
    if (recoveryObject(value)['accepted'] != true) { recoveryInvalid(); }
    // Deliberately ignore arbitrary server messages and account-existence data.
  }

  Future<void> completeReset(String link, String next, bool Function() current) async {
    final token = tokenFromLink(link, RecoveryPurpose.reset);
    if (newPasswordError(next) != null) { throw const FormatException('RECOVERY_PASSWORD_INVALID'); }
    await _gate(current);
    final result = recoveryObject(await api.postForSession('/auth/recovery/reset',
      withAuth: false, sessionIsCurrent: current, body: {'token': token, 'newPassword': next}));
    if (result['changed'] != true || result['reauthenticate'] != true) { recoveryInvalid(); }
  }

  Future<void> completeVerification(String link, bool Function() current) async {
    final token = tokenFromLink(link, RecoveryPurpose.verify);
    await _gate(current);
    final result = recoveryObject(await api.postForSession('/auth/recovery/verify',
      withAuth: false, sessionIsCurrent: current, body: {'token': token}));
    if (result['verified'] != true) { recoveryInvalid(); }
    // The token identifies an address, not necessarily the current login.
    // The caller must re-read /account/email before marking that login verified.
  }
}
