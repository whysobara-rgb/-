/// 가치가차 - 백엔드 iconName을 로컬 3D 클레이 렌더링 상품 이미지
/// 에셋 경로로 매핑하는 유틸리티.
///
/// 백엔드가 제공하는 실제 상품 사진(imageUrl)은 외부 CDN 지연/장애가
/// 발생할 수 있어, Claymorphism & Pastel 3D 무드에 맞는 로컬 3D
/// 렌더링 아이콘을 우선 노출한다. imageUrl 로딩이 성공하면 실사진을
/// 사용하고, 실패 시(네트워크 오류·타임아웃 등) 이 매퍼가 반환하는
/// 3D 클레이 이미지로 폴백한다.
class ProductImageMapper {
  ProductImageMapper._();

  static const String _base = 'assets/images/products';

  static const Map<String, String> _map = {
    'watch_rounded': '$_base/product_watch.png',
    'phone_iphone': '$_base/product_phone.png',
    'checkroom': '$_base/product_fashion.png',
    'face_retouching_natural': '$_base/product_beauty.png',
    'shopping_bag': '$_base/product_bag.png',
    'devices': '$_base/product_appliance.png',
    'restaurant': '$_base/product_food.png',
    'card_giftcard': '$_base/product_giftcard.png',
  };

  /// 기본 폴백 이미지 (매핑되지 않는 iconName일 경우).
  static const String fallback = '$_base/product_giftcard.png';

  static String resolve(String? iconName) {
    if (iconName == null) return fallback;
    return _map[iconName] ?? fallback;
  }
}
