import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/recovery/recovery_repository.dart';
import '../support/recovery_fixture.dart';

void main() {
  late RecoveryFixture f;
  setUp(() { f = RecoveryFixture(); });
  tearDown(() { f.dispose(); });

  test('public recovery never reads or attaches a saved bearer token', () async {
    await f.repository.requestReset(' u1@example.invalid ', () => true);
    expect(f.storage.reads, 0);
    expect(f.requests.every((r) => !r.headers.containsKey('Authorization')), isTrue);
    expect(f.requests.every((r) => !r.followRedirects), isTrue);
    expect(f.posts.single.url.path, '/auth/recovery/request');
    expect(jsonDecode(f.posts.single.body), {'email':'u1@example.invalid'});
  });
  test('verification mail uses the active authenticated account only', () async {
    await f.repository.requestVerification(() => true);
    expect(f.posts.single.url.path, '/account/email/request');
    expect(f.posts.single.headers['Authorization'], 'Bearer synthetic-only');
    expect(jsonDecode(f.posts.single.body), isEmpty);
  });
  test('disabled capability prevents mutations', () async {
    f.enabled = false;
    await expectLater(f.repository.requestReset('u1@example.invalid', () => true), throwsA(isA<ApiException>()));
    expect(f.posts, isEmpty);
  });
  test('malformed capability and identity assertions fail closed', () {
    for (final value in [null, {}, {...recoveryCaps,'enabled':'true'},
      {...recoveryCaps,'delivery':'SMS'}, {...recoveryCaps,'identityVerificationEnabled':true},
      {...recoveryCaps,'resetMinutes':0}, {...recoveryCaps,'verificationMinutes':1441}]) {
      expect(() => RecoveryCapabilities(value), throwsFormatException);
    }
  });
  test('known and unknown emails return the same accepted result', () async {
    await f.repository.requestReset('known@example.invalid', () => true);
    await f.repository.requestReset('unknown@example.invalid', () => true);
    expect(f.posts.length, 2);
    expect(recoveryAcceptedMessage, contains('가입된 이메일이라면'));
    expect(recoveryAcceptedMessage, contains('실제 발송 여부는 아직 확인되지'));
  });
  test('nonaccepted and malformed success are not treated as delivered', () async {
    for (final v in [null, {}, {'accepted':false}, {'accepted':'true'}]) {
      f.handlers['/auth/recovery/request'] = (_) async => recoveryOk(v);
      await expectLater(f.repository.requestReset('u1@example.invalid', () => true), throwsFormatException);
    }
  });
  test('invalid emails never reach transport', () async {
    for (final value in ['', 'wrong', 'two@@example.invalid', 'a@b', 'x\n@y.z', '${'x' * 256}@example.invalid']) {
      await expectLater(f.repository.requestReset(value, () => true), throwsFormatException);
    }
    expect(f.requests, isEmpty);
  });
  test('configured HTTPS origin and exact purpose are required', () {
    expect(f.repository.tokenFromLink(resetLink, RecoveryPurpose.reset), 'a' * 64);
    expect(f.repository.tokenFromLink(verifyLink, RecoveryPurpose.verify), 'b' * 64);
    for (final link in ['a' * 64, verifyLink, resetLink.replaceFirst('https:', 'http:'),
      resetLink.replaceFirst('mail.example.invalid', 'mail.example.invalid.evil.invalid'),
      resetLink.replaceFirst('mail.example.invalid', 'mail.example.invalid@evil.invalid'),
      resetLink.replaceFirst('/#', '/path/#'), resetLink.replaceFirst('/#', '/?tracking=1#'),
      '$resetLink?extra=1', '$resetLink/next', resetLink.replaceFirst('auth-reset','auth-%72eset'),
      resetLink.replaceFirst('/#','//foo/../#'), resetLink.replaceAll('a' * 64, 'A' * 64)]) {
      expect(() => f.repository.tokenFromLink(link, RecoveryPurpose.reset), throwsFormatException);
    }
  });
  test('missing or unsafe origin disables token consumption', () {
    for (final origin in ['', 'http://mail.example.invalid', '$mailOrigin/path',
      '$mailOrigin?token=x', 'https://x:password@mail.example.invalid', '$mailOrigin/#x']) {
      final r = RecoveryRepository(api: f.api, webOrigin: origin);
      expect(r.trustedOrigin, isNull);
      expect(() => r.tokenFromLink(resetLink, RecoveryPurpose.reset), throwsFormatException);
    }
  });
  test('reset sends token and exact password in body, never URL or bearer', () async {
    await f.repository.completeReset(resetLink, ' newTest123! ', () => true);
    final r = f.posts.single;
    expect(r.url.path, '/auth/recovery/reset'); expect(r.url.hasQuery, isFalse);
    expect(r.url.hasFragment, isFalse); expect(r.followRedirects, isFalse);
    expect(jsonDecode(r.body), {'token':'a' * 64, 'newPassword':' newTest123! '});
    expect(r.headers.containsKey('Authorization'), isFalse); expect(f.storage.reads, 0);
  });
  test('password policy and link validation run before dispatch', () async {
    await expectLater(f.repository.completeReset(resetLink, 'bad', () => true), throwsFormatException);
    await expectLater(f.repository.completeReset(verifyLink, 'newTest123!', () => true), throwsFormatException);
    expect(f.requests, isEmpty);
  });
  test('reset requires both exact success flags and does not auto login', () async {
    for (final value in [{}, {'changed':true}, {'changed':true,'reauthenticate':false}]) {
      f.handlers['/auth/recovery/reset'] = (_) async => recoveryOk(value);
      await expectLater(f.repository.completeReset(resetLink, 'newTest123!', () => true), throwsFormatException);
    }
    expect(f.requests.any((r) => r.url.path == '/auth/login'), isFalse);
    expect(f.storage.value, 'synthetic-only');
  });
  test('verification completion uses only its token', () async {
    await f.repository.completeVerification(verifyLink, () => true);
    expect(jsonDecode(f.posts.single.body), {'token':'b' * 64});
    expect(f.posts.single.headers.containsKey('Authorization'), isFalse);
  });
  test('email status verifies address and coherent verified date', () async {
    expect((await f.repository.emailStatus('u1@example.invalid', () => true)).verified, isFalse);
    await expectLater(f.repository.emailStatus('other@example.invalid', () => true), throwsFormatException);
    for (final v in [
      {'email':'u1@example.invalid','verified':true,'verifiedAt':null},
      {'email':'u1@example.invalid','verified':false,'verifiedAt':'2026-09-16T00:00:00Z'},
      {'email':'u1@example.invalid','verified':true,'verifiedAt':'yesterday'}]) {
      expect(() => EmailVerificationStatus(v), throwsFormatException);
    }
  });
  test('scope changes before dispatch prevent public mutations', () async {
    var current = true;
    final done = f.repository.requestReset('u1@example.invalid', () => current);
    final assertion = expectLater(done, throwsA(isA<ApiSessionChangedException>()));
    current = false; await assertion;
    expect(f.posts, isEmpty);
  });
  test('late responses from an old generation cannot be accepted', () async {
    final barrier = Completer<http.Response>(); var current = true;
    f.handlers['/auth/recovery/reset'] = (_) => barrier.future;
    final pending = f.repository.completeReset(resetLink, 'newTest123!', () => current);
    final assertion = expectLater(pending, throwsA(isA<ApiSessionChangedException>()));
    await pumpEventQueue(); current = false;
    barrier.complete(recoveryOk({'changed':true,'reauthenticate':true}));
    await assertion; expect(f.posts.length, 1);
  });
  test('redirect or network loss never replays token consumption', () async {
    for (final redirect in [true, false]) {
      f.requests.clear();
      f.handlers['/auth/recovery/reset'] = (_) async {
        if (redirect) { return http.Response('', 307, headers:{'location':'https://evil.example.invalid'}); }
        throw http.ClientException('synthetic failure');
      };
      await expectLater(f.repository.completeReset(resetLink, 'newTest123!', () => true), throwsA(isA<ApiException>()));
      expect(f.posts.length, 1);
    }
  });
  test('missing authenticated credentials prevent verification requests', () async {
    f.storage.value = null;
    await expectLater(f.repository.requestVerification(() => true), throwsA(isA<ApiSessionChangedException>()));
    expect(f.posts, isEmpty);
  });
}
