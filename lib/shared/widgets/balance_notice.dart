import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';

class BalanceNotice extends StatelessWidget {
  const BalanceNotice({super.key});
  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (!auth.isBalanceStale) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1D6),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.sync_problem_rounded, color: Color(0xFF805400)),
          const SizedBox(height: 8),
          Text(
            auth.profileRefreshError!,
            style: const TextStyle(color: Color(0xFF604000)),
          ),
          TextButton(
            onPressed: auth.refreshProfile,
            child: const Text('잔액 다시 확인'),
          ),
        ],
      ),
    );
  }
}
