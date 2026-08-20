import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/theme/app_colors.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/presentation/login_page.dart';
import 'navigation/main_navigation.dart';
import 'shared/providers/auth_provider.dart';
import 'shared/providers/gp_provider.dart';

void main() {
  runApp(const GachaVaultApp());
}

class GachaVaultApp extends StatelessWidget {
  const GachaVaultApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => GpProvider()),
      ],
      child: MaterialApp(
        title: '가치가차',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.lightTheme,
        themeMode: ThemeMode.light,
        // 전역 모바일 프레임: 웹/넓은 화면에서도 앱이 모바일 폭(최대 430)으로
        // 중앙 정렬되고, 남는 좌우 영역은 다크 톤(darkSurface)으로 채워진다.
        // (화이트 앱 셸 바깥 여백을 다크로 채워 모바일 프레임 경계가
        // 뚜렷하게 보이도록 함) 이후 새로 추가하는 화면은 이 설정을 자동으로
        // 상속받으므로 화면마다 개별적으로 ConstrainedBox/maxWidth를
        // 추가하지 않아도 된다.
        builder: (context, child) {
          return Container(
            color: AppColors.darkSurface,
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

/// 로그인 여부(AuthProvider.isLoggedIn)에 따라
/// LoginPage 또는 MainNavigation(하단 4탭)을 보여주는 게이트 위젯.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    final isLoggedIn = context.watch<AuthProvider>().isLoggedIn;
    return isLoggedIn ? const MainNavigation() : const LoginPage();
  }
}
