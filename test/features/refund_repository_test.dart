import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/refunds/refund_models.dart';
import '../support/refund_fixture.dart';

void main() {
  late RefundFixture f;
  setUp(()=>f=RefundFixture());
  tearDown(()=>f.dispose());
  test('reads all order pages using the same authenticated contract', () async {
    f.history=List.generate(25,(i)=>{...summaryData(orderData()),'orderId':'aaaaaaaa-aaaa-4aaa-8aaa-${i.toRadixString(16).padLeft(12,'0')}'});
    final repo=f.repository();
    final (first,n)=await repo.orders(1);
    final (last,total)=await repo.orders(2);
    expect(first.length,20);expect(last.length,5);expect(n,25);expect(total,25);
    expect(f.mutations,isEmpty);
  });
  test('reads partial refunds and pending/refunded capsules without losing the order', () async {
    f.data['status']='PARTIALLY_REFUNDED';f.data['refundedQuantity']=1;
    f.data['capsules'][0]['status']='REFUNDED';f.data['capsules'][1]['status']='REFUND_PENDING';
    final order=await f.repository().order(orderId);
    expect(order.summary.refundedQuantity,1);expect(order.summary.unopenedCount,0);
    expect(order.capsules[1].status,'REFUND_PENDING');
  });
  test('missing historical terms never become invented refund dates', () async {
    f.data['refundEligible']=false;f.data['refundUntil']=null;f.data['refundPolicy']=null;
    final o=await f.repository().order(orderId);
    expect(o.summary.refundEligible,isFalse);expect(o.summary.refundUntil,isNull);
  });
  test('quote binds order, selection, amount, currency and original policy', () async {
    final repo=f.repository(); final o=await repo.order(orderId);
    for(final patch in [
      {'orderId':otherOrderId},{'amount':101},{'currency':'KRW'},
      {'refundPolicy':{'version':999}},{'refundUntil':'2030-01-12T14:59:59.999Z'}, {'quantity':2},
    ]) {
      f.quoteHandler=(_)async=>response({...f.quote([firstCapsule]),...patch});
      await expectLater(repo.quote(o,[firstCapsule]),throwsA(isA<ApiException>()));
    }
    expect(f.mutations,isEmpty);
  });
  test('duplicates and opened capsules cannot be quoted', () async {
    final repo=f.repository(); final o=await repo.order(orderId);
    await expectLater(repo.quote(o,[firstCapsule,firstCapsule]),throwsA(isA<ApiException>()));
    await expectLater(repo.quote(o,[thirdCapsule]),throwsA(isA<ApiException>()));
    expect(f.quoteCalls,0);
  });
  test('local, server and card gates block refund mutations', () async {
    final repo=f.repository(); final q=await f.getQuote(repo);
    await expectLater(f.repository(preview:false).submit(q,'시험 사유'),throwsA(isA<ApiException>()));
    f.enabled=false;await expectLater(repo.submit(q,'시험 사유'),throwsA(isA<ApiException>()));
    expect(f.mutations,isEmpty);expect(f.store.values,isEmpty);
    f.enabled=true; f.data=orderData(currency:'KRW');f.cashEnabled=false;
    await expectLater(f.getQuote(repo),throwsA(isA<ApiException>()));
  });
  test('failed journal persistence prevents dispatch', () async {
    final repo=f.repository();final q=await f.getQuote(repo);f.store.failWrite=true;
    await expectLater(repo.submit(q,'시험 사유'),throwsStateError);expect(f.mutations,isEmpty);
  });
  test('persists exact key/body before dispatch and retains success until acknowledgement', () async {
    final repo=f.repository();final q=await f.getQuote(repo);
    f.mutationHandler=(r)async {
      final p=PendingRefund.fromJson(jsonDecode(f.store.values[repo.scope]!),repo.scope);
      expect(r.headers['Idempotency-Key'],p.key);expect(jsonDecode(r.body),p.request);
      expect(r.followRedirects,isFalse);f.record(r);return response(f.receipt);
    };
    final result=await repo.submit(q,' 시험 사유 ');
    expect(result.succeeded,isTrue);expect(await repo.pending(),isNotNull);
    await repo.acknowledge();expect(await repo.pending(),isNull);expect(f.mutations.length,1);
  });
  test('lost success survives recreation and GET recovery never refunds twice', () async {
    final repo=f.repository();final q=await f.getQuote(repo);
    f.mutationHandler=(r)async{f.record(r);throw http.ClientException('synthetic response lost');};
    await expectLater(repo.submit(q,'시험 사유'),throwsA(isA<ApiException>()));
    final key=(await repo.pending())!.key;
    final recreated=f.repository();final r=await recreated.recover();
    expect(r!.pending.key,key);expect(r.receipt!.succeeded,isTrue);
    expect((await recreated.retry())!.succeeded,isTrue);expect(f.mutations.length,1);
    await recreated.acknowledge();expect(f.store.values,isEmpty);
  });
  test('missing record permits only explicit identical-key/body replay', () async {
    final repo=f.repository();final q=await f.getQuote(repo);
    f.mutationHandler=(_)async=>throw http.ClientException('lost before receipt');
    await expectLater(repo.submit(q,'시험 사유'),throwsA(isA<ApiException>()));
    final original=f.mutations.single;
    final r=await repo.recover();expect(r!.receipt,isNull);expect(r.retryAllowed,isTrue);
    expect(f.mutations.length,1);f.mutationHandler=null;await repo.retry();
    expect(f.mutations.length,2);expect(f.mutations.last.body,original.body);
    expect(f.mutations.last.headers['Idempotency-Key'],original.headers['Idempotency-Key']);
  });
  test('PROCESSING and UNKNOWN never redispatch or acknowledge', () async {
    for(final status in ['PROCESSING','UNKNOWN']) {
      final x=RefundFixture(currency:'KRW');
      try {
        final repo=x.repository();final q=await x.getQuote(repo);
        x.mutationHandler=(r)async{x.record(r,status:status);return response(x.receipt);};
        expect((await repo.submit(q,'시험 사유')).succeeded,isFalse);
        expect((await repo.recover())!.retryAllowed,isFalse);
        await repo.retry();expect(x.mutations.length,1);
        await expectLater(repo.acknowledge(),throwsA(isA<ApiException>()));expect(await repo.pending(),isNotNull);
      } finally {x.dispose();}
    }
  });
  test('APPROVED replays identical key for server completion and never invents GP', () async {
    f.data=orderData(currency:'KRW');final repo=f.repository();final q=await f.getQuote(repo);
    f.mutationHandler=(r)async{f.record(r,status:'APPROVED');return response(f.receipt);};
    await repo.submit(q,'시험 사유');final key=f.mutations.single.headers['Idempotency-Key'];
    f.mutationHandler=null;final result=await repo.retry();
    expect(result!.currency,'KRW');expect(result.balanceAfter,isNull);
    expect(f.mutations.last.headers['Idempotency-Key'],key);
  });
  test('mismatched success or recovery never clears the journal', () async {
    final repo=f.repository();final q=await f.getQuote(repo);
    f.mutationHandler=(r)async {f.record(r);return response({...f.receipt!,'amount':999});};
    await expectLater(repo.submit(q,'시험 사유'),throwsA(isA<ApiException>()));expect(await repo.pending(),isNotNull);
    f.lookupOverride={...f.receipt!,'orderId':otherOrderId};
    await expectLater(repo.recover(),throwsA(isA<ApiException>()));expect(await repo.pending(),isNotNull);
  });
  test('first definite rejection releases intent only after confirmed absence', () async {
    final repo=f.repository();final q=await f.getQuote(repo);f.mutationHandler=(_)async=>reject(409,10005);
    await expectLater(repo.submit(q,'시험 사유'),throwsA(isA<ApiException>()));
    expect(await repo.pending(),isNull);expect(f.trace.any((s)=>s.contains('/by-request/')),isTrue);
  });
  test('a rejection with a committed record or failed lookup retains intent', () async {
    final repo=f.repository();final q=await f.getQuote(repo);
    f.mutationHandler=(r)async{f.record(r,status:'APPROVED');return reject(409,10005);};
    await expectLater(repo.submit(q,'시험 사유'),throwsA(isA<ApiException>()));expect(await repo.pending(),isNotNull);
    f.failLookup=true;await expectLater(repo.recover(),throwsA(isA<ApiException>()));expect(await repo.pending(),isNotNull);
  });
  test('uncertain replay rejection cannot discard earlier intent', () async {
    final repo=f.repository();final q=await f.getQuote(repo);
    f.mutationHandler=(_)async=>throw http.ClientException('lost');
    await expectLater(repo.submit(q,'시험 사유'),throwsA(isA<ApiException>()));
    f.mutationHandler=(_)async=>reject(409,10005);
    await expectLater(repo.retry(),throwsA(isA<ApiException>()));expect(await repo.pending(),isNotNull);
  });
  test('six concurrent submissions produce one client mutation', () async {
    final repo=f.repository();final q=await f.getQuote(repo);
    final results=await Future.wait(List.generate(6,(_)=>repo.submit(q,'시험 사유')
      .then<Object>((r)=>r).catchError((Object e)=>e)));
    expect(results.whereType<RefundReceipt>().length,1);expect(f.mutations.length,1);
  });
  test('pending blocks new request and is isolated by server/user', () async {
    final repo=f.repository();final q=await f.getQuote(repo);
    f.mutationHandler=(_)async=>throw http.ClientException('lost');
    await expectLater(repo.submit(q,'시험 사유'),throwsA(isA<ApiException>()));
    await expectLater(repo.submit(q,'다른 사유'),throwsA(isA<ApiException>()));expect(f.mutations.length,1);
    expect(await f.repository(userId:2).pending(),isNull);
    expect(await f.repository(server:'https://other.example.invalid').pending(),isNull);
  });
  test('wrong owner and expired login cannot dispatch or expose pending data', () async {
    final repo=f.repository();final q=await f.getQuote(repo);f.user=2;
    await expectLater(repo.submit(q,'시험 사유'),throwsA(isA<ApiSessionChangedException>()));
    f.live=false;await expectLater(repo.pending(),throwsA(isA<ApiSessionChangedException>()));expect(f.mutations,isEmpty);
  });
  test('logout during persistence prevents dispatch', () async {
    final repo=f.repository();final q=await f.getQuote(repo);f.store.writeBarrier=Completer<void>();
    final pending=repo.submit(q,'시험 사유');final check=expectLater(pending,throwsA(isA<ApiSessionChangedException>()));
    await pumpEventQueue();f.live=false;f.store.writeBarrier!.complete();await check;
    expect(f.mutations,isEmpty);expect(f.store.values,isNotEmpty);
  });
  test('delete failure does not repeat a completed refund', () async {
    final repo=f.repository();final q=await f.getQuote(repo);await repo.submit(q,'시험 사유');
    f.store.failRemove=true;await expectLater(repo.acknowledge(),throwsStateError);
    await repo.retry();expect(f.mutations.length,1);expect(await repo.pending(),isNotNull);
  });
  test('corrupt journal and invalid server values fail closed', () async {
    final repo=f.repository();f.store.values[repo.scope]='{"schemaVersion":9}';
    await expectLater(repo.pending(),throwsA(isA<ApiException>()));
    for(final date in ['2030-02-30T00:00:00Z','2030-01-01','2030-01-01T24:00:00Z']) {
      expect(()=>refundDate(date),throwsA(isA<ApiException>()));
    }
    for(final patch in [{'total':-1},{'currency':'USD'},{'refundedQuantity':4},{'status':'UNKNOWN'}]) {
      expect(()=>OrderSummary({...summaryData(orderData()),...patch}),throwsA(isA<ApiException>()));
    }
    final d=orderData();d['capsules'][1]['id']=firstCapsule;
    expect(()=>RefundOrder(d),throwsA(isA<ApiException>()));
    expect(()=>boundedInt(9007199254740992,max:9007199254740991),throwsA(isA<ApiException>()));
  });
}
