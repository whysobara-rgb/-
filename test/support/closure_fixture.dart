import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import 'package:gacha_vault/features/closure/closure_repository.dart';

const closureId = '11111111-1111-4111-8111-111111111111';
const closureKey = '22222222-2222-4222-8222-222222222222';
const closureSummary = {'balance':500, 'unopened':2, 'inventory':1,
  'shipping':0, 'payments':0, 'refunds':0, 'tickets':0};
const closureCaps = {'contract':'ACCOUNT_SUPPORT_V1','enabled':true,'closureMode':'REQUEST_ONLY'};
Map<String, dynamic> closureRow({String reason = '정리 요청', bool cancelled = false}) => {
  'requestId':closureId,'status':cancelled ? 'CANCELLED' : 'REQUESTED','reason':reason,
  'summary':{...closureSummary},'createdAt':'2026-09-16T00:00:00.000Z',
  'cancelledAt':cancelled ? '2026-09-16T01:00:00.000Z' : null,'accountDeleted':false,
};
http.Response closureOk(dynamic data) => http.Response(jsonEncode({'statusCode':10000,'data':data}),200,
  headers:{'content-type':'application/json; charset=utf-8'});
http.Response closureFailure(int status) => http.Response(jsonEncode({
  'statusCode':status == 404 ? 10004 : 10005,'message':'SYNTHETIC_PRIVATE_ERROR',
}),status);
class ClosureToken extends TokenStorage {
  String? value = 'synthetic-closure-token';
  @override
  Future<String?> readToken() async => value;
  @override
  Future<void> saveToken(String token) async { value = token; }
  @override
  Future<void> clearToken() async { value = null; }
}
class ClosureStore implements OrderStore {
  final values = <String,String>{};
  bool failWrite = false, failRemove = false;
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    if (failWrite) { throw StateError('synthetic storage unavailable'); }
    values[key] = value;
  }
  @override
  Future<void> remove(String key) async {
    if (failRemove) { throw StateError('synthetic storage unavailable'); }
    values.remove(key);
  }
}
class ClosureFixture {
  final token = ClosureToken(), store = ClosureStore();
  late final http.Client client;
  late final ApiClient api;
  late final AuthProvider auth;
  late ClosureRepository repository;
  final requests = <http.Request>[];
  final handlers = <String, Future<http.Response> Function(http.Request)>{};
  Map<String,dynamic>? row;
  String? requestKey;
  bool enabled = true;
  int user = 1;
  ClosureFixture() {
    client = MockClient((r) async {
      requests.add(r);
      if (handlers[r.url.path] case final handler?) { return handler(r); }
      if (r.url.path == '/users/me') {
        return closureOk({'id':user,'email':'synthetic$user@example.invalid','nickname':'시험','coinBalance':500});
      }
      if (r.url.path == '/auth/login') { return closureOk({'accessToken':'synthetic-$user'}); }
      if (r.url.path == '/account/capabilities') { return closureOk({...closureCaps,'enabled':enabled}); }
      if (r.url.path == '/account/closure-check') {
        return closureOk({'mode':'REQUEST_ONLY','automaticDeletionEnabled':false,
          'summary':{...closureSummary},'active':row != null && row!['status'] == 'REQUESTED'
            ? {'id':closureId,'reason':row!['reason'],'status':'REQUESTED','createdAt':row!['createdAt']} : null});
      }
      if (r.url.path == '/account/closure-requests' && r.method == 'POST') {
        return acceptRequest(r);
      }
      if (r.url.path.startsWith('/account/closure-requests/by-request/')) {
        return row != null && requestKey == r.url.path.split('/').last ? closureOk(row) : closureFailure(404);
      }
      if (r.url.path == '/account/closure-requests/$closureId') {
        return row == null ? closureFailure(404) : closureOk(row);
      }
      if (r.url.path == '/account/closure-requests/$closureId/cancel') {
        return acceptCancel(r);
      }
      return closureFailure(404);
    });
    api = ApiClient(client:client, tokenStorage:token, apiBaseUrl:'https://closure.example.invalid');
    auth = AuthProvider(apiClient:api, tokenStorage:token);
  }
  http.Response acceptRequest(http.Request r) {
    final body = jsonDecode(r.body) as Map<String,dynamic>;
    final key = r.headers['Idempotency-Key'];
    if (row != null && requestKey != key) { return closureFailure(409); }
    requestKey = key;
    row ??= closureRow(reason:body['reason'] as String);
    return closureOk(row);
  }
  http.Response acceptCancel(http.Request r) {
    if (row == null) { return closureFailure(404); }
    row = closureRow(reason:row!['reason'] as String, cancelled:true);
    return closureOk(row);
  }
  ClosureRepository bind({int? identity, String server = 'https://closure.example.invalid'}) {
    final generation = auth.sessionGeneration;
    return ClosureRepository(api:api,store:store,userId:identity ?? user,server:server,
      sessionIsCurrent:() => auth.isSessionCurrent(generation));
  }
  Future<void> initialize() async {
    await auth.tryAutoLogin(); repository = bind(); requests.clear();
  }
  List<http.Request> get posts => requests.where((r) => r.method == 'POST' &&
    r.url.path.startsWith('/account/closure-requests')).toList();
  void dispose() { auth.dispose(); client.close(); }
}
