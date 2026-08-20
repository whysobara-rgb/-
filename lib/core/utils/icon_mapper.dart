import 'package:flutter/material.dart';

/// 가치가차 - 백엔드가 내려주는 문자열 아이콘 이름(iconName)을
/// Flutter의 [IconData]로 매핑하는 유틸리티.
///
/// 백엔드 seed 데이터의 iconName 값은 Flutter `Icons.xxx` 상수의 이름
/// 문자열이다 (예: 'watch_rounded' -> Icons.watch_rounded).
/// 매핑되지 않는 값이 들어오면 기본 아이콘([Icons.card_giftcard])을 반환한다.
class IconMapper {
  IconMapper._();

  static const Map<String, IconData> _map = {
    'watch_rounded': Icons.watch_rounded,
    'phone_iphone': Icons.phone_iphone,
    'checkroom': Icons.checkroom,
    'face_retouching_natural': Icons.face_retouching_natural,
    'shopping_bag': Icons.shopping_bag,
    'devices': Icons.devices,
    'restaurant': Icons.restaurant,
    'card_giftcard': Icons.card_giftcard,
  };

  static IconData resolve(String? iconName) {
    if (iconName == null) return Icons.card_giftcard;
    return _map[iconName] ?? Icons.card_giftcard;
  }
}

/// 백엔드 색상 hex 문자열('#RRGGBB' 또는 '#AARRGGBB')을 [Color]로 변환한다.
/// 파싱 실패 시 기본 골드 색상을 반환한다.
Color colorFromHex(String? hex, {Color fallback = const Color(0xFFFFB800)}) {
  if (hex == null || hex.isEmpty) return fallback;
  var value = hex.replaceFirst('#', '');
  if (value.length == 6) value = 'FF$value';
  final parsed = int.tryParse(value, radix: 16);
  if (parsed == null) return fallback;
  return Color(parsed);
}
