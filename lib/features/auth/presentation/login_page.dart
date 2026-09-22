import '../../../shared/widgets/gachi_flow.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../recovery/recovery_page.dart';
import 'signup_page.dart';

/// 이메일 로그인 및 회원가입. 소셜 로그인은 OAuth 검증 연동 후 노출한다.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  @override
  void dispose() {
    _emailController.dispose(); _passwordController.dispose(); super.dispose();
  }

  Future<void> _handleEmailLogin() async {
    final email = _emailController.text.trim(), password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('이메일과 비밀번호를 입력해주세요')));
      return;
    }
    final auth = context.read<AuthProvider>();
    final success = await auth.login(email: email, password: password);
    if (!mounted) { return; }
    if (!success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(auth.errorMessage ?? '로그인에 실패했습니다')));
    }
  }

  void _handleSignUp() {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SignupPage()));
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return GachiFlowScaffold(body: SingleChildScrollView(
      padding: const EdgeInsets.all(GachiSpace.page),
      child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 430),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const SizedBox(height: GachiSpace.section),
          const GachiFlowHeading(label: 'GACHIGACHA', title: '당신의 가치를 뽑아보세요',
            description: '이메일로 로그인하고 나의 보관함을 만나보세요.'),
          TextField(controller: _emailController,
            decoration: const InputDecoration(labelText: '이메일', prefixIcon: Icon(Icons.email_outlined))),
          const SizedBox(height: GachiSpace.lg),
          TextField(controller: _passwordController, obscureText: _obscurePassword,
            decoration: InputDecoration(labelText: '비밀번호', prefixIcon: const Icon(Icons.lock_outline),
              suffixIcon: IconButton(tooltip: _obscurePassword ? '비밀번호 표시' : '비밀번호 숨기기',
                icon: Icon(_obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                onPressed: () => setState(() => _obscurePassword = !_obscurePassword)))),
          const SizedBox(height: GachiSpace.xl),
          if (auth.errorMessage case final String message)
            Padding(padding: const EdgeInsets.only(bottom: GachiSpace.md),
              child: Semantics(liveRegion: true, child: Text(message,
                style: GachiType.body.copyWith(color: GachiColors.error)))),
          GachiPrimaryButton(label: auth.isLoading ? '로그인 확인 중' : '이메일로 로그인',
            onPressed: auth.isLoading ? null : _handleEmailLogin),
          TextButton(key: const Key('login-recovery'),
            onPressed: auth.isLoading ? null : () {
              _passwordController.clear();
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RecoveryPage()));
            }, child: const Text('비밀번호를 잊으셨나요?')),
          const SizedBox(height: GachiSpace.lg),
          GachiSecondaryButton(label: '회원가입', onPressed: _handleSignUp),
        ]))),
    ));
  }
}
