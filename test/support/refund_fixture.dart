import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import 'package:gacha_vault/features/refunds/refund_models.dart';
import 'package:gacha_vault/features/refunds/refund_repository.dart';

const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOrderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const firstCapsule = '11111111-1111-4111-8111-111111111111';
const secondCapsule = '22222222-2222-4222-8222-222222222222';
const thirdCapsule = '33333333-3333-4333-8333-333333333333';
const refundId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const policy = {'version':1,'saleType':'STANDARD','businessDays':7,
  'timeZone':'Asia/Seoul','purchaseDayExcluded':true,'calendarVersion':'synthetic-calendar'};
Map<String,dynamic> orderData({String currency = 'GP'}) => {
  'orderId':orderId, 'gachaId':1, 'title':'합성 시험 박스', 'quantity':3,
  'unitPrice':100, 'total':300, 'currency':currency, 'status':'PAID',
  'refundedQuantity':0, 'refundEligible':true, 'refundUntil':'2030-01-11T14:59:59.999Z',
  'refundPolicy':policy, 'createdAt':'2030-01-01T00:00:00.000Z',
  'capsules':[
    {'id':firstCapsule,'orderId':orderId,'sequence':1,'status':'UNOPENED'},
    {'id':secondCapsule,'orderId':orderId,'sequence':2,'status':'UNOPENED'},
    {'id':thirdCapsule,'orderId':orderId,'sequence':3,'status':'OPENED'},
  ],
};
Map<String,dynamic> summaryData(Map<String,dynamic> order) => {
  ...order, 'unopenedCount':(order['capsules'] as List).where((c)=>c['status']=='UNOPENED').length,
}..remove('capsules');
http.Response response(dynamic data, {int httpStatus = 200}) => http.Response(
  jsonEncode({'statusCode':10000,'message':'success','data':data}), httpStatus,
  headers:{'content-type':'application/json; charset=utf-8'});
http.Response reject(int httpStatus, int code) => http.Response(
  jsonEncode({'statusCode':code,'message':'synthetic private error','errors':['SYNTHETIC']}), httpStatus,
  headers:{'content-type':'application/json; charset=utf-8'});

class RefundStore implements OrderStore {
  final Map<String,String> values = {};
  bool failWrite = false, failRemove = false;
  Completer<void>? writeBarrier;
  @override Future<String?> read(String key) async => values[key];
  @override Future<void> write(String key,String value) async {
    if (failWrite) throw StateError('synthetic storage failure');
    await writeBarrier?.future; values[key]=value;
  }
  @override Future<void> remove(String key) async {
    if (failRemove) throw StateError('synthetic delete failure');
    values.remove(key);
  }
}
class RefundToken extends TokenStorage {
  String? token='synthetic-only';
  Completer<String?>? barrier;
  @override Future<String?> readToken() async => barrier == null ? token : barrier!.future;
  @override Future<void> saveToken(String value) async {token=value;}
  @override Future<void> clearToken() async {token=null;}
}
class RefundFixture {
  final RefundStore store = RefundStore();
  final RefundToken token = RefundToken();
  late final http.Client client;
  late final ApiClient api;
  bool live = true, enabled = true, cashEnabled = true, failLookup = false;
  bool Function() additionalLease = () => true;
  int user = 1, quoteCalls = 0;
  String? recordedKey;
  Map<String,dynamic> data;
  Map<String,dynamic>? receipt;
  List<Map<String,dynamic>>? history;
  final List<http.Request> mutations = [];
  final List<String> trace = [];
  Future<http.Response> Function(http.Request)? mutationHandler, quoteHandler;
  dynamic lookupOverride;
  RefundFixture({String currency='GP'}) : data=orderData(currency:currency) {
    client=MockClient((r) async {
      trace.add('${r.method} ${r.url.path}');
      if (r.url.path=='/users/me') return response({'id':user,'email':'test@example.invalid','nickname':'시험 계정','coinBalance':1000});
      if (r.url.path=='/auth/login') return response({'accessToken':'synthetic-new-session'});
      if (r.url.path=='/order-refunds/capabilities') return response({'contract':'ORDER_REFUND_V1','enabled':enabled,'cashEnabled':cashEnabled,'businessDays':7});
      if (r.url.path=='/transactions/capabilities') return response({'contract':'TRANSACTION_HISTORY_V1','enabled':true});
      if (r.url.path=='/transactions/orders') {
        final rows=history??[summaryData(data)], p=int.parse(r.url.queryParameters['page']!);
        return response({'items':rows.skip((p-1)*20).take(20).toList(),'totalCount':rows.length,'page':p,'limit':20});
      }
      if (r.url.path=='/order-refunds') {
        final rows=receipt==null?[]:[receipt!],p=int.parse(r.url.queryParameters['page']!);
        return response({'items':rows.skip((p-1)*20).take(20).toList(),'totalCount':rows.length,'page':p,'limit':20});
      }
      if (r.url.path=='/orders/$orderId') return response(data);
      if (r.url.path.endsWith('/refund-quote')) {
        quoteCalls++;
        if(quoteHandler!=null)return quoteHandler!(r);
        return response(quote(jsonDecode(r.body)['capsuleIds'].cast<String>()));
      }
      if (r.url.path=='/orders/$orderId/refunds') {
        mutations.add(r);
        if(mutationHandler!=null)return mutationHandler!(r);
        record(r); return response(receipt);
      }
      if (r.url.path.startsWith('/order-refunds/by-request/')) {
        if (failLookup) throw http.ClientException('synthetic lookup failure');
        if (lookupOverride!=null) return response(lookupOverride);
        return recordedKey==r.url.pathSegments.last && receipt!=null ? response(receipt) : reject(404,10004);
      }
      return reject(404,10004);
    });
    api=ApiClient(client:client,tokenStorage:token,apiBaseUrl:'https://refund-test.example.invalid',timeout:const Duration(milliseconds:500));
  }
  RefundRepository repository({bool preview=true,int userId=1,String server='https://refund-test.example.invalid'}) =>
    RefundRepository(OrderRepository(api:api,store:store,userId:userId,server:server),
      sessionIsCurrent:()=>live&&additionalLease(), enabled:preview);
  Map<String,dynamic> quote(List<String> ids) => {
    'orderId':orderId,'capsules':(data['capsules'] as List).where((c)=>ids.contains(c['id'])).map((c)=>{'id':c['id'],'sequence':c['sequence'],'status':c['status']}).toList(),
    'quantity':ids.length,'amount':ids.length*100,'currency':data['currency'],
    'balance':1000,'refundUntil':data['refundUntil'],'refundPolicy':data['refundPolicy'],'cashEnabled':cashEnabled,
  };
  void record(http.Request r,{String status='SUCCEEDED'}) {
    recordedKey=r.headers['Idempotency-Key'];
    final b=jsonDecode(r.body) as Map<String,dynamic>;
    receipt={'refundId':refundId,'orderId':orderId,'capsuleIds':b['capsuleIds'],
      'quantity':(b['capsuleIds'] as List).length,'amount':b['expectedAmount'],
      'currency':data['currency'],'status':status,'reason':b['reason'],
      'balanceAfter':status=='SUCCEEDED'&&data['currency']=='GP'?1100:null,
      'createdAt':'2030-01-01T00:00:01.000Z','completedAt':status=='SUCCEEDED'?'2030-01-01T00:00:02.000Z':null};
    for (final c in data['capsules'] as List) {
      if ((b['capsuleIds'] as List).contains(c['id'])) c['status']=status=='SUCCEEDED'?'REFUNDED':'REFUND_PENDING';
    }
    if (status=='SUCCEEDED') {
      data['refundedQuantity']=(data['capsules'] as List).where((c)=>c['status']=='REFUNDED').length;
      data['status']=data['refundedQuantity']==data['quantity']?'REFUNDED':'PARTIALLY_REFUNDED';
    }
  }
  Future<RefundQuote> getQuote(RefundRepository repo) async => repo.quote(await repo.order(orderId),[firstCapsule]);
  void dispose()=>client.close();
}
