import 'order_models.dart';

/// The durable queue contains purchased capsule IDs and confirmed results only.
/// It cannot generate a prize or purchase anything.
class BatchOpening {
  final String id;
  final List<String> capsuleIds;
  final List<Opening> results;
  final String? inFlight;

  BatchOpening({
    required this.id,
    required List<String> capsuleIds,
    List<Opening> results = const [],
    this.inFlight,
  }) : capsuleIds = List.unmodifiable(capsuleIds),
       results = List.unmodifiable(results) {
    uuid(id);
    if (capsuleIds.isEmpty ||
        capsuleIds.length > 100 ||
        capsuleIds.toSet().length != capsuleIds.length) {
      invalidResponse();
    }
    for (final value in capsuleIds) {
      uuid(value);
    }
    if (results.map((r) => r.capsuleId).toSet().length != results.length ||
        results.map((r) => r.inventoryId).toSet().length != results.length ||
        results.any((r) => !capsuleIds.contains(r.capsuleId)) ||
        (inFlight != null &&
            (!capsuleIds.contains(inFlight) ||
                results.any((r) => r.capsuleId == inFlight)))) {
      invalidResponse();
    }
  }
  bool get complete => results.length == capsuleIds.length;
  int get remaining => capsuleIds.length - results.length;
  String? get nextId {
    if (inFlight != null) return inFlight;
    final done = results.map((r) => r.capsuleId).toSet();
    for (final id in capsuleIds) {
      if (!done.contains(id)) return id;
    }
    return null;
  }

  BatchOpening sending(String capsuleId) => BatchOpening(
    id: id,
    capsuleIds: capsuleIds,
    results: results,
    inFlight: capsuleId,
  );
  BatchOpening confirmed(Opening result) => BatchOpening(
    id: id,
    capsuleIds: capsuleIds,
    results: [...results, result],
  );
  factory BatchOpening.fromJson(dynamic value) {
    final j = object(value);
    if (j['schemaVersion'] != 1 ||
        j['capsuleIds'] is! List ||
        j['results'] is! List) {
      invalidResponse();
    }
    return BatchOpening(
      id: uuid(j['id']),
      capsuleIds: (j['capsuleIds'] as List).map(uuid).toList(),
      results: (j['results'] as List).map(Opening.new).toList(),
      inFlight: j['inFlight'] == null ? null : uuid(j['inFlight']),
    );
  }
  Map<String, dynamic> toJson() => {
    'schemaVersion': 1,
    'id': id,
    'capsuleIds': capsuleIds,
    'inFlight': inFlight,
    'results': results.map((r) => r.toJson()).toList(),
  };
}
