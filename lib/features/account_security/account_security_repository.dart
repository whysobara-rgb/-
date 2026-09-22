import 'dart:convert';
import '../../core/network/api_client.dart';

class AccountSecurityCapabilities {
  final bool enabled;
  const AccountSecurityCapabilities({required this.enabled});

  factory AccountSecurityCapabilities.parse(dynamic input) {
    if (input is! Map<String, dynamic> ||
        input['contract'] != 'ACCOUNT_SUPPORT_V1' ||
        input['enabled'] is! bool ||
        input['closureMode'] != 'REQUEST_ONLY') {
      throw const FormatException('ACCOUNT_SECURITY_CONTRACT');
    }
    return AccountSecurityCapabilities(enabled: input['enabled'] as bool);
  }
}

/// Mirrors the existing server password policy. Validation never trims secrets.
String? currentPasswordError(String value) {
  if (value.length < 8 || value.length > 64) {
    return '현재 비밀번호를 8~64자로 입력해주세요';
  }
  return null;
}

String? newPasswordError(String value) {
  if (value.length < 8 || value.length > 64 ||
      utf8.encode(value).length > 72 ||
      !RegExp(r'[A-Za-z]').hasMatch(value) ||
      !RegExp(r'[0-9]').hasMatch(value) ||
      RegExp(r'[\x00-\x1f\x7f]').hasMatch(value)) {
    return '영문·숫자 포함 8~64자, UTF-8 72바이트 이내로 입력해주세요';
  }
  return null;
}

class AccountSecurityRepository {
  final ApiClient api;
  const AccountSecurityRepository({this.api = const ApiClient()});

  Future<AccountSecurityCapabilities> capabilities(
      bool Function() sessionIsCurrent) async {
    return AccountSecurityCapabilities.parse(await api.getForSession(
      '/account/capabilities', sessionIsCurrent: sessionIsCurrent,
    ));
  }

  Future<void> changePassword(String current, String next,
      bool Function() sessionIsCurrent) async {
    if (currentPasswordError(current) != null ||
        newPasswordError(next) != null || current == next) {
      throw const FormatException('PASSWORD_INPUT_INVALID');
    }
    final result = await api.postForSession('/account/password',
        body: {'currentPassword': current, 'newPassword': next},
        sessionIsCurrent: sessionIsCurrent);
    _confirm(result, 'changed');
  }

  Future<void> revokeSessions(String current,
      bool Function() sessionIsCurrent) async {
    if (currentPasswordError(current) != null) {
      throw const FormatException('PASSWORD_INPUT_INVALID');
    }
    final result = await api.postForSession('/account/revoke-sessions',
        body: {'currentPassword': current},
        sessionIsCurrent: sessionIsCurrent);
    _confirm(result, 'revoked');
  }

  void _confirm(dynamic result, String flag) {
    if (result is! Map<String, dynamic> ||
        result[flag] != true || result['reauthenticate'] != true) {
      throw const FormatException('ACCOUNT_SECURITY_RESULT_UNCONFIRMED');
    }
  }
}
