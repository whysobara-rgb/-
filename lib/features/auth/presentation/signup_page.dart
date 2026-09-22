import '../../../shared/widgets/gachi_flow.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../shared/providers/auth_provider.dart';

/// 가치가차 - 회원가입 페이지 (이메일/비밀번호/닉네임).
///
/// 성공 시 [AuthProvider.signup]이 내부적으로 로그인까지 처리하므로,
/// 이 화면에서는 성공 시 단순히 pop()만 호출하면 AuthGate가
/// isLoggedIn 변화를 감지해 자동으로 메인 화면으로 전환한다.
class SignupPage extends StatefulWidget {
  const SignupPage({super.key});

  @override
  State<SignupPage> createState() => _SignupPageState();
}

class _SignupPageState extends State<SignupPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _nicknameController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _nicknameController.dispose();
    super.dispose();
  }

  Future<void> _handleSignup() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final auth = context.read<AuthProvider>();
    final success = await auth.signup(
      email: _emailController.text.trim(),
      password: _passwordController.text,
      nickname: _nicknameController.text.trim(),
    );

    if (!mounted) return;
    if (success) {
      Navigator.of(context).pop();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(auth.errorMessage ?? '회원가입에 실패했습니다')),
      );
    }
  }

  String? _validateEmail(String? value) {
    if (value == null || value.trim().isEmpty) return '이메일을 입력해주세요';
    final emailRegex = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
    if (!emailRegex.hasMatch(value.trim())) return '올바른 이메일 형식이 아닙니다';
    return null;
  }

  String? _validatePassword(String? value) {
    if (value == null || value.isEmpty) return '비밀번호를 입력해주세요';
    if (value.length < 8) return '비밀번호는 8자 이상이어야 합니다';
    final hasLetterAndDigit = RegExp(r'(?=.*[A-Za-z])(?=.*\d)');
    if (!hasLetterAndDigit.hasMatch(value)) {
      return '영문과 숫자를 최소 1개 이상 포함해야 합니다';
    }
    return null;
  }

  String? _validateNickname(String? value) {
    if (value == null || value.trim().isEmpty) return '닉네임을 입력해주세요';
    if (value.trim().length < 2) return '닉네임은 2자 이상이어야 합니다';
    if (value.trim().length > 20) return '닉네임은 20자 이하여야 합니다';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return GachiFlowScaffold(
      appBar: AppBar(title: const Text('회원가입')),
      body: SingleChildScrollView(padding: const EdgeInsets.all(GachiSpace.page),
        child: Form(key: _formKey, child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const GachiFlowHeading(label: 'JOIN GACHIGACHA', title: '가치 있는 시작',
              description: '가치가차에서 특별한 순간을 만들어보세요'),
            _buildTextField(controller: _emailController, label: '이메일',
              icon: Icons.email_outlined, validator: _validateEmail),
            _buildTextField(controller: _nicknameController, label: '닉네임 (2~20자)',
              icon: Icons.person_outline, validator: _validateNickname),
            _buildTextField(controller: _passwordController, label: '비밀번호',
              icon: Icons.lock_outline, validator: _validatePassword,
              obscure: _obscurePassword, helper: '영문과 숫자를 포함해 8자 이상 입력해주세요.',
              suffix: IconButton(tooltip: _obscurePassword ? '비밀번호 표시' : '비밀번호 숨기기',
                icon: Icon(_obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                onPressed: () => setState(() => _obscurePassword = !_obscurePassword))),
            const SizedBox(height: GachiSpace.sm),
            GachiPrimaryButton(label: auth.isLoading ? '가입 확인 중' : '회원가입',
              onPressed: auth.isLoading ? null : _handleSignup),
          ])),
      ),
    );
  }

  Widget _buildTextField({required TextEditingController controller,
    required String label, required IconData icon,
    required String? Function(String?) validator, bool obscure = false,
    String? helper, Widget? suffix}) => Padding(
      padding: const EdgeInsets.only(bottom: GachiSpace.lg),
      child: TextFormField(controller: controller, validator: validator,
        obscureText: obscure, decoration: InputDecoration(labelText: label,
          helperText: helper, prefixIcon: Icon(icon), suffixIcon: suffix)),
    );
}
