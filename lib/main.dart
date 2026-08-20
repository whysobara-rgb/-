import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'core/theme/app_colors.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/presentation/login_page.dart';
import 'navigation/main_navigation.dart';
import 'shared/providers/auth_provider.dart';
import 'shared/providers/gp_provider.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // 풀스크린 실제 앱 느낌을 위해 시스템 UI를 edge-to-edge 모드로 설정하고
  // 상태바를 투명하게 처리한다. (모바일 빌드에서 특히 효과적)
  SystemChrome.setEnabledSystemUIMode(
    SystemUiMode.edgeToEdge,
    overlays: [SystemUiOverlay.top],
  );
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      statusBarBrightness: Brightness.light,
      systemNavigationBarColor: AppColors.scaffoldBg,
      systemNavigationBarIconBrightness: Brightness.dark,
      systemNavigationBarDividerColor: Colors.transparent,
    ),
  );

  runApp(const GachaVaultApp());
}

class GachaVaultApp extends StatelessWidget {
  const GachaVaultApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        // GpProvider는 AuthProvider.currentUser(로그인/로그아웃/프로필 갱신)에
        // 맞춰 잔액을 자동 동기화하는 ProxyProvider로 구성한다.
        ChangeNotifierProxyProvider<AuthProvider, GpProvider>(
          create: (_) => GpProvider(),
          update: (_, auth, gp) {
            final provider = gp ?? GpProvider();
            provider.syncFromUser(auth.currentUser);
            return provider;
          },
        ),
      ],
      child: MaterialApp(
        title: '가치가차',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.lightTheme,
        themeMode: ThemeMode.light,
        // 전역 모바일 프레임: 웹/넓은 화면에서도 앱이 모바일 폭(최대 430)으로
        // 중앙 정렬되고, 남는 좌우 영역은 앱 배경과 동일한 크림톤으로 채워진다.
        builder: (context, child) {
          return Container(
            color: AppColors.scaffoldBg,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 430),
                child: child,
              ),
            ),
          );
        },
        home: const AuthGate(),
      ),
    );
  }
}

/// 앱 시작 시 저장된 토큰으로 자동 로그인을 시도하고,
/// 로그인 여부(AuthProvider.isLoggedIn)에 따라
/// LoginPage 또는 MainNavigation(하단 탭)을 보여주는 게이트 위젯.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AuthProvider>().tryAutoLogin();
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    if (auth.isInitializing) {
      return const Scaffold(
        backgroundColor: AppColors.scaffoldBg,
        body: Center(
          child: CircularProgressIndicator(color: AppColors.goldPrimary),
        ),
      );
    }

    return auth.isLoggedIn ? const MainNavigation() : const LoginPage();
  }
}
