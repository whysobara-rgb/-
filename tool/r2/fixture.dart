import 'package:flutter/material.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';

// NON-TRANSACTIONAL editorial review only. Never merged into API catalog data.
// Photo subjects are NOT a claim about any live gacha or its prizes.
const r2Boxes = [
  CapsuleBox(
    id: 9901,
    name: '사운드 박스',
    category: 'tech',
    priceWon: 1000,
    icon: Icons.headphones_outlined,
    accentColor: Color(0xFFCFAA61),
    imageUrl: 'https://review.invalid/sound.jpg',
  ),
  CapsuleBox(
    id: 9902,
    name: '테이블 박스',
    category: 'home',
    priceWon: 500,
    icon: Icons.coffee_outlined,
    accentColor: Color(0xFFCFAA61),
    imageUrl: 'https://review.invalid/table.jpg',
  ),
  CapsuleBox(
    id: 9903,
    name: '커피 브레이크',
    category: 'food',
    priceWon: 300,
    icon: Icons.coffee_outlined,
    accentColor: Color(0xFFCFAA61),
    imageUrl: 'https://review.invalid/coffee.jpg',
  ),
];
