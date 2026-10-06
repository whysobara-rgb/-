/**
 * Display strings for layout names, descriptions, chokepoints and shop signs.
 * Merged into the UI i18n dictionaries (src/ui/i18n.ts).
 *
 * Korean is primary (cute, friendly tone); English mirrors every key.
 * test/sim/layouts.test.ts checks that every key used by a layout exists in both.
 */
export const LAYOUT_STRINGS: { ko: Record<string, string>; en: Record<string, string> } = {
  ko: {
    // --- layouts -------------------------------------------------------------
    'layout.plaza.name': '수집 광장',
    'layout.plaza.desc': '외곽의 작은 금고는 가깝지만, 은행은 공원을 빙 돌아가야 해요. 꾸준히 먼저 쌓을까, 큰 운반에 시간을 쓸까?',
    'layout.shortcut.name': '지름길 상가',
    'layout.shortcut.desc': '은행으로 약한 펜스를 뚫으면 모두의 지름길이 열려요. 내가 길을 열까, 상대가 연 길을 이용할까?',
    'layout.counter.name': '열린 창구',
    'layout.counter.desc': '두 은행의 문이 시계탑 사거리를 마주 보고 있어요. 은행을 빨리 옮길까, 문을 지킬까, 먼저 내용물을 빼낼까?',
    'layout.tutorial.name': '연습 마당',
    'layout.tutorial.desc': '작은 금고를 우리 차로 가져오고, 은행 뒤로 돌아가 통째로 밀어서 펜스를 뚫어 봐요!',

    // --- chokepoints: 수집 광장 -------------------------------------------------
    'choke.plaza.flowerRoadW': '서쪽 꽃길',
    'choke.plaza.flowerRoadE': '동쪽 꽃길',
    'choke.plaza.bakeryAlley': '빵집 골목',
    'choke.plaza.donutAlley': '도넛 골목',
    'choke.plaza.bookAlley': '책방 골목',
    'choke.plaza.musicAlley': '음반 골목',
    'choke.plaza.fountain': '분수 광장',
    'choke.plaza.postLane': '우체국 뒷길',

    // --- chokepoints: 지름길 상가 -----------------------------------------------
    'choke.shortcut.arcadeAlley': '오락실 골목',
    'choke.shortcut.boardgameAlley': '보드게임 골목',
    'choke.shortcut.doorAlleyW': '서쪽 은행 샛길',
    'choke.shortcut.doorAlleyE': '동쪽 은행 샛길',
    'choke.shortcut.edgeLaneW': '서쪽 담장길',
    'choke.shortcut.edgeLaneE': '동쪽 담장길',
    'choke.shortcut.crossing': '중앙 사거리',
    'choke.shortcut.backStreet': '뒷골목 시장 입구',

    // --- chokepoints: 열린 창구 -------------------------------------------------
    'choke.counter.northCounter': '북쪽 창구 앞',
    'choke.counter.southCounter': '남쪽 창구 앞',
    'choke.counter.northBackDoor': '북쪽 은행 뒷문',
    'choke.counter.southBackDoor': '남쪽 은행 뒷문',
    'choke.counter.bakeryAlley': '빵집 골목',
    'choke.counter.donutAlley': '도넛 골목',
    'choke.counter.laundryAlley': '빨래방 골목',
    'choke.counter.flowerAlley': '꽃집 골목',

    // --- chokepoints: 연습 마당 -------------------------------------------------
    'choke.tutorial.northGate': '북쪽 쪽문',
    'choke.tutorial.southGate': '남쪽 쪽문',

    // --- shop signs -------------------------------------------------------------
    'sign.cafe': '너구리 카페',
    'sign.tea': '몽글 찻집',
    'sign.bakery': '말랑 빵집',
    'sign.donut': '동글 도넛',
    'sign.toy': '뽀짝 장난감',
    'sign.arcade': '뿅뿅 오락실',
    'sign.flower': '꽃방울 꽃집',
    'sign.icecream': '사르르 아이스크림',
    'sign.books': '책벌레 책방',
    'sign.music': '빙글 음반가게',
    'sign.ramen': '후루룩 라멘',
    'sign.laundry': '뽀송 빨래방',
    'sign.post': '도토리 우체국',
    'sign.pharmacy': '토닥 약국',
    'sign.grocery': '아삭 채소가게',
    'sign.bike': '씽씽 자전거',
    'sign.photo': '찰칵 사진관',
    'sign.mall': '반짝 상가',
    'sign.tteok': '쫀득 떡집',
    'sign.stationery': '사각 문구점',
    'sign.practice': '너구리 연습장',
    'sign.dumpling': '모락 만두',
    'sign.bubbletea': '동동 버블티',
    'sign.boardgame': '데굴 보드게임',
    'sign.candy': '달콩 사탕가게',
    'sign.toast': '바삭 토스트',
    'sign.plant': '초록 화분가게',
    'sign.barber': '싹둑 미용실',
    'sign.comics': '두근 만화방',
    'sign.kimbap': '돌돌 김밥',
  },
  en: {
    // --- layouts -------------------------------------------------------------
    'layout.plaza.name': 'Collection Plaza',
    'layout.plaza.desc': 'The outer small safes are close, but banks must roll the long way around the park. Stack points early, or spend time on the big haul?',
    'layout.shortcut.name': 'Shortcut Arcade',
    'layout.shortcut.desc': 'Bust a weak fence with a bank and a shortcut opens for everyone. Open the way yourself, or use the one your rival opened?',
    'layout.counter.name': 'Open Counter',
    'layout.counter.desc': 'Both bank doors face the clock-tower crossing. Move the bank fast, guard the door, or grab what is inside first?',
    'layout.tutorial.name': 'Practice Yard',
    'layout.tutorial.desc': 'Bring a small safe to your van, then circle behind the bank and push it whole through the fence!',

    // --- chokepoints: Collection Plaza ------------------------------------------
    'choke.plaza.flowerRoadW': 'West Flower Road',
    'choke.plaza.flowerRoadE': 'East Flower Road',
    'choke.plaza.bakeryAlley': 'Bakery Alley',
    'choke.plaza.donutAlley': 'Donut Alley',
    'choke.plaza.bookAlley': 'Bookshop Alley',
    'choke.plaza.musicAlley': 'Record Shop Alley',
    'choke.plaza.fountain': 'Fountain Square',
    'choke.plaza.postLane': 'Post Office Back Lane',

    // --- chokepoints: Shortcut Arcade -------------------------------------------
    'choke.shortcut.arcadeAlley': 'Arcade Alley',
    'choke.shortcut.boardgameAlley': 'Board Game Alley',
    'choke.shortcut.doorAlleyW': 'West Bank Passage',
    'choke.shortcut.doorAlleyE': 'East Bank Passage',
    'choke.shortcut.edgeLaneW': 'West Wall Lane',
    'choke.shortcut.edgeLaneE': 'East Wall Lane',
    'choke.shortcut.crossing': 'Central Crossing',
    'choke.shortcut.backStreet': 'Back-Street Market Gate',

    // --- chokepoints: Open Counter ------------------------------------------------
    'choke.counter.northCounter': 'North Counter Front',
    'choke.counter.southCounter': 'South Counter Front',
    'choke.counter.northBackDoor': 'North Bank Back Door',
    'choke.counter.southBackDoor': 'South Bank Back Door',
    'choke.counter.bakeryAlley': 'Bakery Alley',
    'choke.counter.donutAlley': 'Donut Alley',
    'choke.counter.laundryAlley': 'Laundromat Alley',
    'choke.counter.flowerAlley': 'Flower Shop Alley',

    // --- chokepoints: Practice Yard ---------------------------------------------
    'choke.tutorial.northGate': 'North Gate',
    'choke.tutorial.southGate': 'South Gate',

    // --- shop signs -------------------------------------------------------------
    'sign.cafe': 'Raccoon Café',
    'sign.tea': 'Cozy Tea House',
    'sign.bakery': 'Squishy Bakery',
    'sign.donut': 'Round Donuts',
    'sign.toy': 'Tiny Toy Shop',
    'sign.arcade': 'Pew-Pew Arcade',
    'sign.flower': 'Blossom Florist',
    'sign.icecream': 'Melty Ice Cream',
    'sign.books': 'Bookworm Books',
    'sign.music': 'Spin Records',
    'sign.ramen': 'Slurp Ramen',
    'sign.laundry': 'Fluffy Laundromat',
    'sign.post': 'Acorn Post Office',
    'sign.pharmacy': 'Pat-Pat Pharmacy',
    'sign.grocery': 'Crunchy Greengrocer',
    'sign.bike': 'Zoom Bikes',
    'sign.photo': 'Snap Photo Studio',
    'sign.mall': 'Twinkle Mall',
    'sign.tteok': 'Chewy Rice Cakes',
    'sign.stationery': 'Scribble Stationery',
    'sign.practice': 'Raccoon Practice Yard',
    'sign.dumpling': 'Puffy Dumplings',
    'sign.bubbletea': 'Bobble Tea',
    'sign.boardgame': 'Roll-a-Dice Board Games',
    'sign.candy': 'Sweet Bean Candy',
    'sign.toast': 'Crispy Toast',
    'sign.plant': 'Little Green Plants',
    'sign.barber': 'Snip-Snip Salon',
    'sign.comics': 'Doki Comics',
    'sign.kimbap': 'Roll-Roll Kimbap',
  },
};
