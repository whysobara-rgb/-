// Synthetic presentation fixtures, never imported by lib/ or sent to an API.
import 'package:flutter/material.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/domain/gacha_detail.dart';
import 'package:gacha_vault/features/orders/order_models.dart';

const v33Boxes = [
  CapsuleBox(
    id: 901,
    name: '취향을 채우는 컬렉션 박스',
    category: 'tech',
    priceWon: 1000,
    icon: Icons.inventory_2_outlined,
    accentColor: Color(0xFFCFAA61),
  ),
  CapsuleBox(
    id: 902,
    name: '작은 행복, 데일리 박스',
    category: 'home',
    priceWon: 100,
    icon: Icons.inventory_2_outlined,
    accentColor: Color(0xFFCFAA61),
  ),
  CapsuleBox(
    id: 903,
    name: '새로운 발견',
    category: 'other',
    priceWon: 500,
    icon: Icons.inventory_2_outlined,
    accentColor: Color(0xFFCFAA61),
  ),
];
const v33Detail = GachaDetail(
  id: 901,
  title: '취향을 채우는 컬렉션 박스',
  description: '구성 상품과 공개 확률을 확인하고 나만의 컬렉션을 시작하세요.',
  price: 1000,
  icon: Icons.inventory_2_outlined,
  accentColor: Color(0xFFCFAA61),
  totalStock: 1000,
  soldStock: 120,
  lineup: [],
);
final v33Odds = Odds({
  'gachaId': 901,
  'unitPrice': 1000,
  'currency': 'GP',
  'version': 'a' * 64,
  'snapshot': {
    'schemaVersion': 1,
    'mode': 'FIXED_PPM',
    'entries': [
      {
        'itemId': 1,
        'name': '일반 컬렉션 카드',
        'rarity': 'N',
        'conversionGP': 0,
        'probabilityPpm': 900000,
        'isPremium': false,
      },
      {
        'itemId': 2,
        'name': '프리미엄 컬렉션 카드',
        'rarity': 'SSR',
        'conversionGP': 0,
        'probabilityPpm': 100000,
        'isPremium': true,
      },
    ],
  },
});
