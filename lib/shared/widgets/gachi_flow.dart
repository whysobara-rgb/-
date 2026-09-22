import 'package:flutter/material.dart';
import 'gachi_components.dart';
export 'gachi_components.dart';

/// V33 commerce/account presentation only. No requests, state mapping or policy.
abstract final class GachiFlowStyle {
  static const hero = BoxDecoration(
    color: GachiColors.navy,
    borderRadius: GachiShape.card,
    boxShadow: GachiShape.shadow,
  );
  static ThemeData get theme {
    final base = GachiTheme.data;
    return base.copyWith(
      cardTheme: const CardThemeData(
        color: GachiColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.symmetric(vertical: GachiSpace.sm),
        shape: RoundedRectangleBorder(
          borderRadius: GachiShape.card,
          side: BorderSide(color: GachiColors.divider),
        ),
      ),
      listTileTheme: const ListTileThemeData(
        textColor: GachiColors.ink,
        iconColor: GachiColors.secondary,
        titleTextStyle: GachiType.product,
        subtitleTextStyle: GachiType.meta,
        contentPadding: EdgeInsets.all(GachiSpace.lg),
      ),
      inputDecorationTheme: base.inputDecorationTheme.copyWith(
        errorMaxLines: 5,
        helperMaxLines: 5,
        labelStyle: GachiType.body.copyWith(color: GachiColors.secondary),
        floatingLabelStyle: GachiType.meta.copyWith(color: GachiColors.ink),
      ),
      chipTheme: base.chipTheme.copyWith(
        labelStyle: GachiType.meta,
        secondaryLabelStyle: GachiType.meta.copyWith(
          color: GachiColors.surface,
        ),
      ),
    );
  }
}

class GachiFlowScaffold extends StatelessWidget {
  final PreferredSizeWidget? appBar;
  final Widget body;
  final Color? backgroundColor;
  const GachiFlowScaffold({
    super.key,
    this.appBar,
    required this.body,
    this.backgroundColor,
  });
  @override
  Widget build(BuildContext context) => Theme(
    data: GachiFlowStyle.theme,
    child: Scaffold(
      appBar: appBar,
      backgroundColor: backgroundColor,
      body: SafeArea(
        top: appBar == null,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: SizedBox(width: double.infinity, child: body),
          ),
        ),
      ),
    ),
  );
}

class GachiFlowHeading extends StatelessWidget {
  final String label, title, description;
  const GachiFlowHeading({
    super.key,
    required this.label,
    required this.title,
    this.description = '',
  });
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: GachiSpace.xl),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GachiType.english.copyWith(color: GachiColors.secondary),
        ),
        const SizedBox(height: GachiSpace.sm),
        Semantics(header: true, child: Text(title, style: GachiType.pageTitle)),
        if (description.isNotEmpty) ...[
          const SizedBox(height: GachiSpace.md),
          Text(
            description,
            style: GachiType.body.copyWith(color: GachiColors.secondary),
          ),
        ],
      ],
    ),
  );
}

class GachiFlowSummary extends StatelessWidget {
  final String title, value;
  final String? description;
  const GachiFlowSummary({
    super.key,
    required this.title,
    required this.value,
    this.description,
  });
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.symmetric(vertical: GachiSpace.md),
    padding: const EdgeInsets.all(GachiSpace.page),
    decoration: GachiFlowStyle.hero,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: GachiType.meta.copyWith(color: GachiColors.ivory)),
        const SizedBox(height: GachiSpace.sm),
        Text(
          value,
          style: GachiType.pageTitle.copyWith(color: GachiColors.surface),
        ),
        if (description != null) ...[
          const SizedBox(height: GachiSpace.md),
          Text(
            description!,
            style: GachiType.body.copyWith(color: GachiColors.ivory),
          ),
        ],
      ],
    ),
  );
}

/// Customer-support reference remains copyable, secondary to status/actions.
class GachiReference extends StatelessWidget {
  final String text;
  const GachiReference(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: GachiSpace.md),
    child: SelectableText(
      text,
      style: GachiType.meta.copyWith(color: GachiColors.muted),
    ),
  );
}

class GachiFlowDialog extends StatelessWidget {
  final Widget? title, content;
  final List<Widget>? actions;
  final bool scrollable;
  const GachiFlowDialog({
    super.key,
    this.title,
    this.content,
    this.actions,
    this.scrollable = true,
  });
  @override
  Widget build(BuildContext context) => Theme(
    data: GachiFlowStyle.theme,
    child: AlertDialog(
      title: title,
      content: content,
      actions: actions,
      scrollable: scrollable,
      backgroundColor: GachiColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: GachiShape.card),
    ),
  );
}

/// Forms keep focusable controls mounted while remaining scrollable at 200%.
class GachiFlowList extends StatelessWidget {
  final EdgeInsetsGeometry? padding;
  final List<Widget> children;
  const GachiFlowList({super.key, this.padding, required this.children});
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: padding,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}
