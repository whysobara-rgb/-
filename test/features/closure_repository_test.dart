import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/closure/closure_models.dart';
import '../support/closure_fixture.dart';

void main() {
  late ClosureFixture f;
  setUp(() async { f = ClosureFixture(); await f.initialize(); });
  tearDown(() { f.dispose(); });
  test('reads current obligations and refuses automatic deletion contracts', () async {
    final c = await f.repository.check();
    expect(c.summary.values['balance'],500); expect(c.active,isNull);
    for (final patch in [{'mode':'DELETE_NOW'},{'automaticDeletionEnabled':true}]) {
      expect(() => ClosureCheck({'mode':'REQUEST_ONLY','automaticDeletionEnabled':false,
        'summary':closureSummary,'active':null,...patch}),throwsA(isA<ApiException>()));
    }
  });
  test('rejects malformed counts, missing fields and invalid timestamp rollovers', () {
    for (final value in [-1,'500',9007199254740992,null]) {
      expect(() => ClosureSummary({...closureSummary,'balance':value}),throwsA(isA<ApiException>()));
    }
    for (final stamp in ['2026-02-31T00:00:00Z','2026-01-01T24:00:00Z','yesterday']) {
      expect(() => closureDate(stamp),throwsA(isA<ApiException>()));
    }
    expect(() => ClosureReceipt({...closureRow(),'accountDeleted':true}),throwsA(isA<ApiException>()));
    expect(() => ClosureReceipt({...closureRow(),'status':'DELETED'}),throwsA(isA<ApiException>()));
  });
  test('journal cannot carry credentials or unrecognized actions', () {
    final j = PendingClosure('request',closureKey,'정리 요청').toJson();
    expect(() => PendingClosure.fromJson({...j,'password':'secret'}),throwsA(isA<ApiException>()));
    expect(() => PendingClosure('delete',closureKey,'정리 요청'),throwsA(isA<ApiException>()));
  });
  test('validates inputs before writing or transmitting', () async {
    await expectLater(f.repository.request('정리 요청','short'),throwsA(isA<ApiException>()));
    await expectLater(f.repository.request(' ','Synthetic123!'),throwsA(isA<ApiException>()));
    expect(f.posts,isEmpty); expect(f.store.values,isEmpty);
  });
  test('six concurrent submissions dispatch only one POST', () async {
    final results = await Future.wait(List.generate(6, (_) => f.repository
      .request('정리 요청','Synthetic123!').then((_) => true,onError: (_) => false)));
    expect(results.where((v) => v).length,1); expect(f.posts.length,1);
  });
  test('stores only the key and reason before sending the exact accepted body', () async {
    f.handlers['/account/closure-requests'] = (r) async {
      expect(f.store.values.length,1);
      final saved = f.store.values.values.single;
      expect(saved, isNot(contains('Synthetic123!')));
      expect(saved,isNot(contains('synthetic-closure-token')));
      expect(jsonDecode(r.body),{'reason':'정리 요청','currentPassword':' Synthetic123! ', 'confirmation':'탈퇴 요청'});
      expect(r.followRedirects,isFalse);
      return f.acceptRequest(r);
    };
    await f.repository.request(' 정리 요청 ',' Synthetic123! ');
    expect((await f.repository.pending())!.reason,'정리 요청');
  });
  test('does not submit if protected storage fails', () async {
    f.store.failWrite = true;
    await expectLater(f.repository.request('정리 요청','Synthetic123!'),throwsStateError);
    expect(f.posts,isEmpty);
  });
  test('lost success response is recovered using GET without replay', () async {
    f.handlers['/account/closure-requests'] = (r) async {
      f.acceptRequest(r); throw http.ClientException('synthetic response lost');
    };
    await expectLater(f.repository.request('정리 요청','Synthetic123!'),throwsA(isA<ApiException>()));
    final recovered = await f.bind().recover();
    expect(recovered!.id,closureId); expect(f.posts.length,1);
    await f.repository.acknowledge(recovered); expect(f.store.values,isEmpty);
  });
  test('explicit retry uses the same key and reason but re-entered password', () async {
    f.handlers['/account/closure-requests'] = (_) async => throw http.ClientException('synthetic unavailable');
    await expectLater(f.repository.request('정리 요청','Synthetic123!'),throwsA(isA<ApiException>()));
    final key = f.posts.single.headers['Idempotency-Key'];
    f.handlers.clear();
    await f.repository.retry(password:'ChangedPassword123!');
    expect(f.posts.length,2);
    expect(f.posts.last.headers['Idempotency-Key'],key);
    expect(jsonDecode(f.posts.last.body)['reason'],'정리 요청');
    expect(f.store.values.values.single,isNot(contains('ChangedPassword123!')));
  });
  test('a missing receipt cannot be retried without a new password entry', () async {
    f.store.values[f.repository.scope] = jsonEncode(PendingClosure('request',closureKey,'정리 요청').toJson());
    await expectLater(f.repository.retry(),throwsA(isA<ApiException>()));
    expect(f.posts,isEmpty); expect(f.store.values,isNotEmpty);
  });
  test('a malformed response is not success and does not erase recovery', () async {
    f.handlers['/account/closure-requests'] = (r) async => closureOk({...closureRow(),'accountDeleted':true});
    await expectLater(f.repository.request('정리 요청','Synthetic123!'),throwsA(isA<ApiException>()));
    expect(f.store.values,isNotEmpty); expect(f.posts.length,1);
  });
  test('existing active request blocks another initial submission', () async {
    f.row = closureRow();
    await expectLater(f.repository.request('정리 요청','Synthetic123!'),throwsA(isA<ApiException>()));
    expect(f.posts,isEmpty); expect(f.store.values,isEmpty);
  });
  test('cancel response loss is confirmed through read-by-ID with no second cancellation', () async {
    f.row = closureRow();
    final active = (await f.repository.check()).active!;
    f.handlers['/account/closure-requests/$closureId/cancel'] = (r) async {
      f.acceptCancel(r); throw http.ClientException('synthetic lost response');
    };
    await expectLater(f.repository.cancel(active),throwsA(isA<ApiException>()));
    final recovered = await f.repository.recover();
    expect(recovered!.cancelled,isTrue); expect(f.posts.length,1);
    await f.repository.acknowledge(recovered); expect(f.store.values,isEmpty);
  });
  test('absent active request or missing read route never means cancelled or deleted', () async {
    f.store.values[f.repository.scope] = jsonEncode(PendingClosure('cancel',closureId,'정리 요청').toJson());
    expect((await f.repository.check()).active,isNull);
    await expectLater(f.repository.recover(),throwsA(isA<ApiException>()));
    expect(f.store.values,isNotEmpty); expect(f.posts,isEmpty);
  });
  test('acknowledgement rechecks the server and retains mismatched results', () async {
    final r = await f.repository.request('정리 요청','Synthetic123!');
    f.row = closureRow(cancelled:true);
    await expectLater(f.repository.acknowledge(r),throwsA(isA<ApiException>()));
    expect(f.store.values,isNotEmpty);
    await f.repository.acknowledge((await f.repository.recover())!);
    expect(f.store.values,isEmpty);
  });
  test('storage removal failure retains recovery and does not resubmit', () async {
    final r = await f.repository.request('정리 요청','Synthetic123!');
    f.store.failRemove = true;
    await expectLater(f.repository.acknowledge(r),throwsStateError);
    expect(f.store.values,isNotEmpty); expect(f.posts.length,1);
    expect((await f.repository.recover())!.id,closureId);
  });
  test('different accounts and servers cannot read the same pending journal', () async {
    await f.repository.request('정리 요청','Synthetic123!');
    expect(await f.bind(identity:2).pending(),isNull);
    expect(await f.bind(server:'https://other.example.invalid').pending(),isNull);
  });
  test('logout during a dispatched operation drops the response and retains its original journal', () async {
    final wait = Completer<http.Response>();
    f.handlers['/account/closure-requests'] = (_) => wait.future;
    final p = f.repository.request('정리 요청','Synthetic123!');
    final expectation = expectLater(p,throwsA(isA<ApiSessionChangedException>()));
    await pumpEventQueue(); expect(f.posts.length,1);
    await f.auth.logout(); wait.complete(closureOk(closureRow())); await expectation;
    expect(f.store.values,isNotEmpty); expect(f.posts.length,1);
  });
  test('authentication failure during recovery does not erase or retry', () async {
    f.store.values[f.repository.scope] = jsonEncode(PendingClosure('request',closureKey,'정리 요청').toJson());
    f.handlers['/account/closure-requests/by-request/$closureKey'] = (_) async => closureFailure(401);
    await expectLater(f.repository.recover(),throwsA(isA<ApiException>()));
    expect(f.store.values,isNotEmpty); expect(f.posts,isEmpty);
  });
});
