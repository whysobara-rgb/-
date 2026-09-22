import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/balance_notice.dart';
import '../../gacha/presentation/gacha_detail_page.dart';
import '../data/capsule_box_repository.dart';
import '../domain/capsule_box.dart';
import 'catalog_views.dart';
export 'catalog_views.dart' show HomeScreen, BoxShopScreen;

import '../../customer_updates/customer_content.dart';
import '../../customer_updates/customer_updates_page.dart';

// Compatibility name for existing catalog callers and visual tests.
typedef CatalogScreen = BoxShopScreen;

class HomePage extends StatefulWidget {
  final VoidCallback onGoToWallet;
  final Future<List<CapsuleBox>> Function()? loadCatalog;
  final bool showShop;
  final int refreshRevision;
  final VoidCallback onShop, onRanking, onOpenUnopened, onCollection;
  const HomePage({
    super.key,
    required this.onGoToWallet,
    this.loadCatalog,
    this.showShop = false,
    this.refreshRevision = 0,
    required this.onShop,
    required this.onRanking,
    required this.onOpenUnopened,
    required this.onCollection,
  });
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  List<CapsuleBox> _boxes = [];
  List<Campaign> _campaigns = [];
  String? _contentError;
  int _catalogRequest = 0, _contentRequest = 0;
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
    _loadContent();
  }

  @override
  void didUpdateWidget(covariant HomePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshRevision != widget.refreshRevision) {
      _load();
      _loadContent();
    }
  }

  Future<void> _loadContent() async {
    final request = ++_contentRequest;
    try {
      final rows = await const CustomerContentRepository().campaigns();
      if (mounted && request == _contentRequest) {
        setState(() {
          _campaigns = rows.where((c) => c.homeVisible).take(5).toList();
          _contentError = null;
        });
      }
    } catch (e) {
      if (mounted && request == _contentRequest) {
        setState(() {
          _campaigns = [];
          _contentError = '소식을 불러오지 못했어요. 새로고침 후 확인해주세요.';
        });
      }
    }
  }

  Future<void> _load() async {
    final request = ++_catalogRequest;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final boxes =
          await (widget.loadCatalog?.call() ??
              const CapsuleBoxRepository().getAll());
      if (mounted && request == _catalogRequest) {
        setState(() {
          _boxes = boxes;
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted && request == _catalogRequest) {
        setState(() {
          _loading = false;
          _error = error is ApiException
              ? error.message
              : '박스를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
        });
      }
    }
  }

  Future<void> _open(CapsuleBox box) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            GachaDetailPage(box: box, onGoToWallet: widget.onGoToWallet),
      ),
    );
    if (mounted) {
      await context.read<AuthProvider>().refreshProfile();
      if (mounted) {
        await _load();
      }
    }
  }

  Future<void> _refresh() async {
    await Future.wait([
      _load(),
      _loadContent(),
      context.read<AuthProvider>().refreshProfile(),
    ]);
  }

  void _updates() => Navigator.of(
    context,
  ).push(MaterialPageRoute(builder: (_) => const CustomerUpdatesPage()));

  @override
  Widget build(BuildContext context) {
    final balance = context.watch<GpProvider>().formattedBalance;
    return IndexedStack(
      index: widget.showShop ? 1 : 0,
      children: [
        TickerMode(
          enabled: !widget.showShop,
          child: HomeScreen(
            boxes: _boxes,
            campaigns: _campaigns,
            contentError: _contentError,
            onUpdates: _updates,
            loading: _loading,
            error: _error,
            balance: balance,
            balanceNotice: const BalanceNotice(),
            onRefresh: _refresh,
            onOpen: _open,
            onWallet: widget.onGoToWallet,
            onShop: widget.onShop,
            onRanking: widget.onRanking,
            onOpenUnopened: widget.onOpenUnopened,
            onCollection: widget.onCollection,
          ),
        ),
        TickerMode(
          enabled: widget.showShop,
          child: BoxShopScreen(
            boxes: _boxes,
            onUpdates: _updates,
            loading: _loading,
            error: _error,
            balance: balance,
            balanceNotice: const BalanceNotice(),
            onRefresh: _refresh,
            onOpen: _open,
            onWallet: widget.onGoToWallet,
          ),
        ),
      ],
    );
  }
}
