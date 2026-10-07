import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'core/feedback/sfx.dart';
import 'core/theme/app_colors.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/presentation/login_page.dart';
import 'features/auth/social/social_auth_clients.dart';
import 'navigation/main_navigation.dart';
import 'navigation/tab_navigator.dart';
import 'shared/providers/auth_provider.dart';
import 'shared/providers/gp_provider.dart';
import 'shared/widgets/ui.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      statusBarBrightness: Brightness.dark,
      systemNavigationBarColor: AppColors.canvas,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  // 키가 있는 소셜 SDK만 초기화한다. 실패해도 이메일 로그인은 된다.
  unawaited(initSocialSdks().catchError((Object _) {}));
  runApp(const GachaVaultApp());
}

class GachaVaultApp extends StatelessWidget {
  const GachaVaultApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => TabNavigator()),
        // 보유 GP는 로그인 사용자 정보(currentUser.coinBalance)를 따라간다.
        ChangeNotifierProxyProvider<AuthProvider, GpProvider>(
          create: (_) => GpProvider(),
          update: (_, auth, gp) =>
              (gp ?? GpProvider())..syncFromUser(auth.currentUser),
        ),
      ],
      // 로그인 전(로그인·가입)은 1차의 페이퍼 테마, 로그인 후는 나이트 볼트.
      // auth 화면은 흰 바탕을 전제로 색을 직접 지정하고 있어 테마만 바꾼다.
      child: Selector<AuthProvider, bool>(
        selector: (_, auth) => auth.isLoggedIn || auth.isInitializing,
        builder: (context, vault, _) => MaterialApp(
          title: '가치가차',
          debugShowCheckedModeBanner: false,
          theme: vault ? AppTheme.vault : AppTheme.paper,
          // 넓은 화면(웹)에서도 모바일 폭으로 가운데 정렬한다.
          builder: (context, child) => Listener(
            // 웹 자동재생 규칙: 첫 터치 전에는 효과음을 내지 않는다.
            onPointerDown: (_) => SfxPlayer.instance.markUserGesture(),
            child: ColoredBox(
              color: vault ? Colors.black : AppColors.bgSubtle,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 480),
                  child: child,
                ),
              ),
            ),
          ),
          home: const AuthGate(),
        ),
      ),
    );
  }
}

/// 저장된 토큰으로 자동 로그인을 시도하고, 결과에 따라 로그인 또는 메인 탭을 보여준다.
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
      return const Scaffold(body: LoadingView(height: double.infinity));
    }
    return auth.isLoggedIn ? const MainNavigation() : const LoginPage();
  }
}
