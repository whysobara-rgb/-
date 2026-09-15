import '../orders/order_models.dart';

int gpAmount(dynamic value, {bool zero = false}) {
  final n = positive(value, zero: zero);
  if (n > 9007199254740991) invalidResponse();
  return n;
}

List<int> conversionIds(Iterable<int> values) {
  final ids = values.toList()..sort();
  if (ids.isEmpty ||
      ids.length > 100 ||
      ids.toSet().length != ids.length ||
      ids.any((id) => id < 1 || id > 2147483647)) {
    invalidResponse();
  }
  return List.unmodifiable(ids);
}

class ConversionPolicy {
  final int hours, maxRestores;
  ConversionPolicy(dynamic value) : this._(object(value));
  ConversionPolicy._(Map<String, dynamic> j)
    : hours = positive(j['restoreHours']),
      maxRestores = positive(j['maxRestoresPerItem']) {
    if (j['version'] != 1 ||
        j['normalRate'] != 10 ||
        j['premiumRate'] != 100 ||
        j['restoreRule'] != 'NO_GP_SPEND_SINCE_CONVERSION' ||
        hours > 8760 ||
        maxRestores > 20) {
      invalidResponse();
    }
  }
}

class ConversionEntry {
  final int inventoryId, amount;
  final Prize prize;
  ConversionEntry(dynamic value) : this._(object(value));
  ConversionEntry._(Map<String, dynamic> j)
    : inventoryId = positive(j['inventoryItemId']),
      amount = gpAmount(j['amountGP']),
      prize = Prize(j['prize']) {
    if (amount != prize.conversionGP) invalidResponse();
  }
}

List<ConversionEntry> conversionEntries(dynamic value, int total) {
  if (value is! List) invalidResponse();
  final entries = value.map(ConversionEntry.new).toList();
  conversionIds(entries.map((e) => e.inventoryId));
  if (entries.fold<int>(0, (sum, e) => sum + e.amount) != total ||
      total > 2147483647) {
    invalidResponse();
  }
  return List.unmodifiable(entries);
}

class ConversionQuote {
  final int total, balance;
  final String version;
  final ConversionPolicy policy;
  final bool restoreEligible;
  final List<ConversionEntry> entries;
  ConversionQuote(dynamic value) : this._(object(value));
  ConversionQuote._(Map<String, dynamic> j)
    : total = gpAmount(j['totalGP']),
      balance = gpAmount(j['balance'], zero: true),
      version = versionId(j['quoteVersion']),
      policy = ConversionPolicy(j['policy']),
      restoreEligible = j['restoreEligible'] is bool
          ? j['restoreEligible']
          : invalidResponse(),
      entries = conversionEntries(j['entries'], gpAmount(j['totalGP']));
  Map<String, dynamic> get request => {
    'inventoryItemIds': conversionIds(entries.map((e) => e.inventoryId)),
    'expectedTotalGP': total,
    'expectedQuoteVersion': version,
  };
}

class ConversionReceipt {
  final String id, status;
  final int total, balanceAfter;
  final int? restoredBalance;
  final DateTime createdAt, restoreUntil;
  final ConversionPolicy policy;
  final bool canRestore;
  final String? restoreReason;
  final List<ConversionEntry> entries;
  ConversionReceipt(dynamic value) : this._(object(value));
  ConversionReceipt._(Map<String, dynamic> j)
    : id = uuid(j['conversionId']),
      status = label(j['status']),
      total = gpAmount(j['totalGP']),
      balanceAfter = gpAmount(j['balanceAfter'], zero: true),
      restoredBalance = j['restoredBalanceAfter'] == null
          ? null
          : gpAmount(j['restoredBalanceAfter'], zero: true),
      createdAt = DateTime.parse(label(j['createdAt'])),
      restoreUntil = DateTime.parse(label(j['restoreUntil'])),
      policy = ConversionPolicy(j['policy']),
      canRestore = j['canRestore'] is bool
          ? j['canRestore']
          : invalidResponse(),
      restoreReason = j['restoreReason'] as String?,
      entries = conversionEntries(j['items'], gpAmount(j['totalGP'])) {
    if (!{'CONVERTED', 'RESTORED'}.contains(status) ||
        (status == 'RESTORED' && (restoredBalance == null || canRestore))) {
      invalidResponse();
    }
  }
  bool get restored => status == 'RESTORED';
}

class PendingConversion {
  final String kind, key;
  final Map<String, dynamic> body;
  PendingConversion(this.kind, this.key, Map<String, dynamic> body)
    : body = Map.unmodifiable(body) {
    uuid(key);
    if (kind == 'convert') {
      conversionIds((body['inventoryItemIds'] as List).map((v) => positive(v)));
      if (gpAmount(body['expectedTotalGP']) > 2147483647) invalidResponse();
      versionId(body['expectedQuoteVersion']);
    } else if (kind == 'restore') {
      uuid(body['conversionId']);
    } else {
      invalidResponse();
    }
  }
  factory PendingConversion.fromJson(dynamic value) {
    final j = object(value);
    return PendingConversion(
      label(j['kind']),
      uuid(j['key']),
      object(j['body']),
    );
  }
  Map<String, dynamic> toJson() => {'kind': kind, 'key': key, 'body': body};
}
