import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/features/recovery/recovery_repository.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';

const mailOrigin = 'https://mail.example.invalid';
final resetLink = '$mailOrigin/#auth-reset/${'a' * 64}';
final verifyLink = '$mailOrigin/#auth-verify/${'b' * 64}';
const recoveryCaps = {'contract':'ACCOUNT_RECOVERY_V1', 'enabled':true,
  'resetMinutes':15, 'verificationMinutes':30, 'delivery':'EMAIL',
  'identityVerificationEnabled':false};
http.Response recoveryOk(dynamic value) => http.Response(jsonEncode({
  'statusCode':10000, 'data':value}), 200,
  headers: {'content-type':'application/json; charset=utf-8'});
http.Response recoveryFailure(int status) => http.Response(jsonEncode({
  'statusCode':10005, 'message':'SYNTHETIC_SECRET_DO_NOT_DISPLAY'}), status);

class RecoveryTokenStore extends TokenStorage {
  String? value = 'synthetic-only';
  int reads = 0;
  @override
  Future<String?> readToken() async { reads++; return value; }
  @override
  Future<void> saveToken(String token) async { value = token; }
  @override
  Future<void> clearToken() async { value = null; }
}

class RecoveryFixture {
  final storage = RecoveryTokenStore();
  late final http.Client client;
  late final ApiClient api;
  late final AuthProvider auth;
  late final RecoveryRepository repository;
  final requests = <http.Request>[];
  final handlers = <String, Future<http.Response> Function(http.Request)>{};
  bool enabled = true, verified = false;
  int user = 1;
  RecoveryFixture({String origin = mailOrigin}) {
    client = MockClient((r) async {
      requests.add(r);
      if (handlers[r.url.path] case final handler?) { return handler(r); }
      switch (r.url.path) {
        case '/auth/login': return recoveryOk({'accessToken':'synthetic-$user'});
        case '/users/me': return recoveryOk({'id':user, 'email':'u$user@example.invalid',
          'nickname':'시험 계정', 'coinBalance':100});
        case '/auth/recovery/capabilities': return recoveryOk({...recoveryCaps,'enabled':enabled});
        case '/account/email': return recoveryOk({'email':'u$user@example.invalid',
          'verified':verified, 'verifiedAt':verified ? '2026-09-16T00:00:00.000Z' : null});
        case '/auth/recovery/request':
        case '/account/email/request': return recoveryOk({'accepted':true, 'message':'IGNORED_SERVER_TEXT'});
        case '/auth/recovery/reset': return recoveryOk({'changed':true,'reauthenticate':true});
        case '/auth/recovery/verify': verified = true; return recoveryOk({'verified':true});
        default: return recoveryFailure(404);
      }
    });
    api = ApiClient(client: client, tokenStorage: storage, apiBaseUrl:'https://api.example.invalid');
    auth = AuthProvider(apiClient: api, tokenStorage: storage);
    repository = RecoveryRepository(api: api, webOrigin: origin);
  }
  List<http.Request> get posts => requests.where((r) => r.method == 'POST').toList();
  Future<void> initialize({bool signedIn = false}) async {
    if (signedIn) { await auth.tryAutoLogin(); }
    else { await auth.logout(); }
    requests.clear(); storage.reads = 0;
  }
  void dispose() { auth.dispose(); client.close(); }
}
