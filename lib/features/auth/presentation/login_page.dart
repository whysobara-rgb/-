import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
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
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.scaffoldBg,
    body: SafeArea(child: SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 48),
      child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 430),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _buildLogo(), const SizedBox(height: 8), _buildSlogan(),
          const SizedBox(height: 36), _buildEmailField(), const SizedBox(height: 12),
          _buildPasswordField(), const SizedBox(height: 20),
          if (context.watch<AuthProvider>().errorMessage case final String message)
            Padding(padding: const EdgeInsets.only(bottom: 12),
              child: Semantics(liveRegion: true,
                child: Text(message, style: const TextStyle(color: AppColors.error)))),
          _buildLoginButton(),
          TextButton(key: const Key('login-recovery'),
            onPressed: context.watch<AuthProvider>().isLoading ? null : () {
              _passwordController.clear();
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RecoveryPage()));
            },
            child: const Text('비밀번호를 잊으셨나요?')),
          const SizedBox(height: 16), _buildSignUpLink(),
        ])),
      ),
    )),
  );

  Widget _buildLogo() => ShaderMask(
    shaderCallback: (bounds) => AppColors.goldGradient.createShader(bounds),
    child: const FittedBox(fit: BoxFit.scaleDown,
      child: Text('GACHIGACHA', softWrap: false, maxLines: 1, textAlign: TextAlign.center,
        style: TextStyle(fontSize: 38, fontWeight: FontWeight.w900,
          color: Colors.white, letterSpacing: 0.5))),
  );

  Widget _buildSlogan() => const Text('당신의 가치를 뽑아보세요', textAlign: TextAlign.center,
    style: TextStyle(fontSize: 14, color: AppColors.textSecondary));

  Widget _buildEmailField() => _buildTextField(controller: _emailController,
    hintText: '이메일', prefixIcon: Icons.email_outlined, obscureText: false);

  Widget _buildPasswordField() => _buildTextField(controller: _passwordController,
    hintText: '비밀번호', prefixIcon: Icons.lock_outline, obscureText: _obscurePassword,
    suffixIcon: IconButton(icon: Icon(_obscurePassword
        ? Icons.visibility_off_outlined : Icons.visibility_outlined,
      color: AppColors.textSecondary, size: 20),
      tooltip: _obscurePassword ? '비밀번호 표시' : '비밀번호 숨기기',
      onPressed: () => setState(() => _obscurePassword = !_obscurePassword)));

  Widget _buildTextField({required TextEditingController controller,
    required String hintText, required IconData prefixIcon, required bool obscureText,
    Widget? suffixIcon}) => Container(
    decoration: BoxDecoration(color: AppColors.surfaceElevated2,
      borderRadius: BorderRadius.circular(12)),
    child: TextField(controller: controller, obscureText: obscureText,
      style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
      decoration: InputDecoration(hintText: hintText,
        hintStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
        prefixIcon: Icon(prefixIcon, color: AppColors.textSecondary, size: 20),
        suffixIcon: suffixIcon, border: InputBorder.none,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14))),
  );

  Widget _buildLoginButton() {
    final loading = context.watch<AuthProvider>().isLoading;
    return Container(width: double.infinity, height: 54,
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(12),
        gradient: loading ? null : AppColors.goldGradient,
        color: loading ? AppColors.surfaceBorder : null),
      child: Material(color: Colors.transparent, borderRadius: BorderRadius.circular(12),
        child: InkWell(onTap: loading ? null : _handleEmailLogin,
          borderRadius: BorderRadius.circular(12),
          child: Center(child: loading ? const SizedBox(width: 22, height: 22,
            child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.textSecondary))
            : const Text('이메일로 로그인', style: TextStyle(fontSize: 16,
              fontWeight: FontWeight.w700, color: Color(0xFF1A1A1A)))))),
    );
  }

  Widget _buildSignUpLink() => Center(child: TextButton(onPressed: _handleSignUp,
    child: RichText(text: const TextSpan(
      style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
      children: [TextSpan(text: '아직 계정이 없으신가요? '),
        TextSpan(text: '회원가입', style: TextStyle(color: AppColors.goldPrimary,
          fontWeight: FontWeight.w700, decoration: TextDecoration.underline,
          decorationColor: AppColors.goldPrimary))]))));
}
