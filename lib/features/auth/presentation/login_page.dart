import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import 'widgets/social_login_button.dart';

/// 가치가차 - 로그인 페이지
///
/// 소셜 로그인(카카오/구글/네이버/Apple) + 이메일 로그인(더미) + 회원가입 링크(더미)
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
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _showComingSoon(String provider) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('$provider 로그인은 아직 준비중입니다')));
  }

  void _handleEmailLogin() {
    // 더미 로그인: 유효성 검사 없이 바로 로그인 처리 후 홈으로 이동.
    context.read<AuthProvider>().login();
  }

  void _handleSignUp() {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('회원가입은 아직 준비중입니다')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 48),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildLogo(),
                  const SizedBox(height: 8),
                  _buildSlogan(),
                  const SizedBox(height: 36),
                  _buildSocialButtons(),
                  const SizedBox(height: 28),
                  _buildDivider(),
                  const SizedBox(height: 28),
                  _buildEmailField(),
                  const SizedBox(height: 12),
                  _buildPasswordField(),
                  const SizedBox(height: 20),
                  _buildLoginButton(),
                  const SizedBox(height: 16),
                  _buildSignUpLink(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── 로고 & 슬로건 ────────────────────────────────────────────────
  Widget _buildLogo() {
    return ShaderMask(
      shaderCallback: (bounds) => AppColors.goldGradient.createShader(bounds),
      child: const Text(
        'GACHIGACHA',
        textAlign: TextAlign.center,
        style: TextStyle(
          fontSize: 38,
          fontWeight: FontWeight.w900,
          color: Colors.white,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  Widget _buildSlogan() {
    return const Text(
      '당신의 가치를 뽑아보세요',
      textAlign: TextAlign.center,
      style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
    );
  }

  // ── 소셜 로그인 버튼 4종 (기존 디자인 유지) ─────────────────────────
  Widget _buildSocialButtons() {
    return Column(
      children: [
        SocialLoginButton(
          label: '카카오로 시작하기',
          backgroundColor: const Color(0xFFFEE500),
          foregroundColor: const Color(0xFF3C1E1E),
          icon: const Text(
            'K',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: Color(0xFF3C1E1E),
            ),
          ),
          onTap: () => _showComingSoon('카카오'),
        ),
        const SizedBox(height: 12),
        SocialLoginButton(
          label: '구글로 시작하기',
          backgroundColor: Colors.white,
          foregroundColor: const Color(0xFF333333),
          border: Border.all(color: AppColors.surfaceBorder),
          icon: const Text(
            'G',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: Color(0xFF4285F4),
            ),
          ),
          onTap: () => _showComingSoon('구글'),
        ),
        const SizedBox(height: 12),
        SocialLoginButton(
          label: '네이버로 시작하기',
          backgroundColor: const Color(0xFF03C75A),
          foregroundColor: Colors.white,
          icon: const Text(
            'N',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: Colors.white,
            ),
          ),
          onTap: () => _showComingSoon('네이버'),
        ),
        const SizedBox(height: 12),
        SocialLoginButton(
          label: 'Apple로 시작하기',
          backgroundColor: const Color(0xFF1C1C1E),
          foregroundColor: Colors.white,
          icon: const Icon(Icons.apple, size: 22, color: Colors.white),
          onTap: () => _showComingSoon('Apple'),
        ),
      ],
    );
  }

  // ── "또는" 구분선 ────────────────────────────────────────────────
  Widget _buildDivider() {
    return const Row(
      children: [
        Expanded(child: Divider(color: AppColors.surfaceBorder)),
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            '또는',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
        ),
        Expanded(child: Divider(color: AppColors.surfaceBorder)),
      ],
    );
  }

  // ── 이메일 입력 필드 ─────────────────────────────────────────────
  Widget _buildEmailField() {
    return _buildTextField(
      controller: _emailController,
      hintText: '이메일',
      prefixIcon: Icons.email_outlined,
      obscureText: false,
    );
  }

  // ── 비밀번호 입력 필드 ───────────────────────────────────────────
  Widget _buildPasswordField() {
    return _buildTextField(
      controller: _passwordController,
      hintText: '비밀번호',
      prefixIcon: Icons.lock_outline,
      obscureText: _obscurePassword,
      suffixIcon: IconButton(
        icon: Icon(
          _obscurePassword
              ? Icons.visibility_off_outlined
              : Icons.visibility_outlined,
          color: AppColors.textSecondary,
          size: 20,
        ),
        onPressed: () {
          setState(() => _obscurePassword = !_obscurePassword);
        },
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String hintText,
    required IconData prefixIcon,
    required bool obscureText,
    Widget? suffixIcon,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF5F5F5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextField(
        controller: controller,
        obscureText: obscureText,
        style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
        decoration: InputDecoration(
          hintText: hintText,
          hintStyle: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 14,
          ),
          prefixIcon: Icon(
            prefixIcon,
            color: AppColors.textSecondary,
            size: 20,
          ),
          suffixIcon: suffixIcon,
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 14,
          ),
        ),
      ),
    );
  }

  // ── 이메일 로그인 버튼 ───────────────────────────────────────────
  Widget _buildLoginButton() {
    return Container(
      width: double.infinity,
      height: 54,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        gradient: AppColors.goldGradient,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: _handleEmailLogin,
          borderRadius: BorderRadius.circular(12),
          child: const Center(
            child: Text(
              '이메일로 로그인',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: Color(0xFF1A1A1A),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── 회원가입 링크 ────────────────────────────────────────────────
  Widget _buildSignUpLink() {
    return Center(
      child: TextButton(
        onPressed: _handleSignUp,
        child: RichText(
          text: const TextSpan(
            style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
            children: [
              TextSpan(text: '아직 계정이 없으신가요? '),
              TextSpan(
                text: '회원가입',
                style: TextStyle(
                  color: AppColors.goldPrimary,
                  fontWeight: FontWeight.w700,
                  decoration: TextDecoration.underline,
                  decorationColor: AppColors.goldPrimary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
