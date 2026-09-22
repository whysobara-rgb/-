import '../../core/network/api_client.dart';
import '../../shared/data/activity_page.dart';
import '../orders/order_models.dart' show object, uuid;

class Campaign {
  final String id, title, body, kind;
  final String? imageUrl;
  final int? gachaId;
  final int sortOrder;
  final bool homeVisible;
  final DateTime startsAt, endsAt;
  Campaign(Map<String, dynamic> j)
    : id = uuid(j['id']),
      title = activityText(j['title']),
      body = activityText(j['body']),
      kind = activityText(j['kind']),
      imageUrl = _image(j['imageUrl']),
      gachaId = j['gachaId'] == null ? null : activityInt(j['gachaId'], min: 1),
      sortOrder = activityInt(j['sortOrder'] ?? 50),
      homeVisible = j['homeVisible'] == true,
      startsAt = activityDate(j['startsAt']),
      endsAt = activityDate(j['endsAt']) {
    if (!['NOTICE', 'SHOWCASE'].contains(kind) ||
        (kind == 'SHOWCASE') != (gachaId != null) ||
        !endsAt.isAfter(startsAt) ||
        sortOrder > 999) {
      invalidActivity();
    }
  }
  static String? _image(dynamic value) {
    if (value == null || value == '') {
      return null;
    }
    if (value is! String) {
      invalidActivity();
    }
    final u = Uri.tryParse(value);
    if (u == null ||
        u.scheme != 'https' ||
        u.host.isEmpty ||
        u.userInfo.isNotEmpty) {
      invalidActivity();
    }
    return value;
  }
}

/// Reads the same published projections and customer-owned queues as the web app.
class CustomerContentRepository {
  final ApiClient api;
  const CustomerContentRepository({this.api = const ApiClient()});
  Future<List<Campaign>> campaigns() async {
    final r = object(await api.get('/campaigns', withAuth: false));
    if (r['contract'] != 'CAMPAIGNS_V1' || r['items'] is! List) {
      invalidActivity();
    }
    final rows = (r['items'] as List).map((x) => Campaign(object(x))).toList();
    if (rows.map((x) => x.id).toSet().length != rows.length) {
      invalidActivity();
    }
    rows.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return List.unmodifiable(rows);
  }

  Future<ActivityPage<Map<String, dynamic>>> page(String kind, int page) async {
    final endpoint = switch (kind) {
      'notices' => '/announcements',
      'tickets' => '/support/tickets',
      'cases' => '/support/cases',
      'inbox' => '/notifications',
      _ => throw ArgumentError('Unknown content kind'),
    };
    final identity = switch (kind) {
      'notices' => 'announcementId',
      'tickets' => 'ticketId',
      'inbox' => 'id',
      _ => 'id',
    };
    return ActivityPage.parse(
      await api.get('$endpoint?page=$page&limit=20'),
      page: page,
      limit: 20,
      parse: (j) {
        if (kind == 'inbox') {
          activityInt(j[identity], min: 1);
        } else {
          uuid(j[identity]);
        }
        activityText(
          j[kind == 'cases'
              ? 'summary'
              : kind == 'tickets'
              ? 'subject'
              : 'title'],
        );
        if (kind == 'cases') {
          uuid(j['orderId']);
          if (![
            'OPEN',
            'IN_PROGRESS',
            'WAITING_EXTERNAL',
            'CLOSED',
          ].contains(j['status'])) {
            invalidActivity();
          }
        }
        return Map<String, dynamic>.unmodifiable(j);
      },
      id: (j) => j[identity].toString(),
    );
  }

  Future<Map<String, dynamic>> ticket(String id, {int after = 0}) async {
    final r = object(
      await api.get('/support/tickets/${uuid(id)}?after=$after'),
    );
    if (object(r['ticket'])['ticketId'] != id ||
        r['messages'] is! List ||
        r['hasMore'] is! bool) {
      invalidActivity();
    }
    int sequence = after;
    for (final raw in r['messages']) {
      final m = object(raw);
      uuid(m['messageId']);
      activityText(m['body']);
      final next = activityInt(m['sequence'], min: 1);
      if (next <= sequence) {
        invalidActivity();
      }
      sequence = next;
    }
    if (r['hasMore'] == true &&
        (r['nextAfter'] != sequence || sequence <= after)) {
      invalidActivity();
    }
    return r;
  }
}
