// 무역왕! 게임 데이터 — 모둠활동지(각 나라별 자연 및 경제환경)와 무역물건 카드를 그대로 옮겼습니다.
// 선생님이 수업에 맞게 이 파일만 고치면 나라·물건·수량을 바꿀 수 있어요.

const GOODS = {
  oil:      { name: '석유',   icon: '🛢️' },
  beef:     { name: '소고기', icon: '🥩' },
  clothes:  { name: '옷',     icon: '👕' },
  phone:    { name: '핸드폰', icon: '📱' },
  ship:     { name: '배',     icon: '🚢' },
  computer: { name: '컴퓨터', icon: '💻' },
  wine:     { name: '와인',   icon: '🍷' },
  rice:     { name: '쌀',     icon: '🍚' },
  banana:   { name: '바나나', icon: '🍌' },
  car:      { name: '자동차', icon: '🚗' },
  rubber:   { name: '고무',   icon: '🛞' },
  coffee:   { name: '커피',   icon: '☕' },
};

const COUNTRY_ORDER = ['red', 'blue', 'yellow', 'green', 'purple', 'pink'];

// startInventory: 풍부한 자원의 시작 수량 (모둠활동지 수정본 기준)
// needs: 부족한 물건 1번 → 2번 → 3번 순서로, qty개를 모두 모아야 그 단계를 해결합니다.
//
// 수량 설계: 한 나라만 파는데 두 나라가 사려는 물건(석유·와인·자동차·커피)은 공급 = 수요 → 구매 경쟁
//           두 나라가 파는 물건(옷·배·쌀·바나나·컴퓨터·소고기)은 공급 > 수요 → 판매 경쟁
const COUNTRIES = {
  red: {
    name: '빨강 나라', color: '#E03A3A', ink: '#FFFFFF',
    rich: ['지하자원 중 석유가 풍부하다. (6나라 중 유일함!)', '가축이 많아 소고기가 싸다.'],
    startInventory: { oil: 10, beef: 7 },
    produces: ['oil', 'beef'],
    needs: [
      { good: 'clothes', qty: 4, text: '국민의 소득 수준이 높아 값비싼 물건(명품 옷 등)의 소비가 많다.' },
      { good: 'phone',   qty: 3, text: '핸드폰의 수요가 높으나 기술이 부족하여 대부분 수입에 의존한다.' },
      { good: 'car',     qty: 5, text: '자동차의 수요가 높으나 기술이 부족하여 대부분 수입에 의존한다.' },
    ],
  },
  blue: {
    name: '파랑 나라', color: '#1F63D6', ink: '#FFFFFF',
    rich: ['기술이 발달하여 전자제품(컴퓨터 등)을 잘 만들고, IT산업이 발달하여 핸드폰 수출을 많이 한다.', '조선(배)산업이 발달하였다.'],
    startInventory: { phone: 4, computer: 6, ship: 4 },
    produces: ['phone', 'ship', 'computer'],
    needs: [
      { good: 'oil',    qty: 5, text: '지하자원(석유)이 부족하여 대부분 수입해야 한다.' },
      { good: 'banana', qty: 3, text: '추운 기후로 열대과일(바나나 등)은 수입한다.' },
      { good: 'wine',   qty: 4, text: '독특한 식문화로 와인의 소비량이 많다.' },
    ],
  },
  yellow: {
    name: '노랑 나라', color: '#F2B400', ink: '#2A2000',
    rich: ['열대기후로 각종 열대과일(바나나 등)과 고무가 많이 생산된다.', '넓은 평야지역에서 쌀이 많이 생산된다.'],
    startInventory: { rice: 4, banana: 5, rubber: 5 },
    produces: ['rice', 'banana', 'rubber'],
    needs: [
      { good: 'computer', qty: 5, text: '기술력이 부족하여 가전제품(컴퓨터) 대부분을 수입한다.' },
      { good: 'wine',     qty: 3, text: '독특한 식문화로 와인의 소비량이 많다.' },
      { good: 'clothes',  qty: 4, text: '경공업이 발달하지 않아 의류(옷) 수입이 필요하다.' },
    ],
  },
  green: {
    name: '초록 나라', color: '#23964A', ink: '#FFFFFF',
    rich: ['넓은 평야지역에서 쌀이 많이 생산된다.', '국토가 넓어 여러 기후가 존재하여 포도와 바나나 농사가 모두 잘 되어 와인과 바나나가 유명하다.', '넓은 초원에서 가축을 길러 소고기도 생산한다.'],
    startInventory: { rice: 4, banana: 4, wine: 7, beef: 3 },
    produces: ['wine', 'rice', 'banana', 'beef'],
    needs: [
      { good: 'ship',   qty: 5, text: '무역을 많이 하기 때문에 배(조선)가 많이 필요하고 수입도 많이 한다.' },
      { good: 'rubber', qty: 4, text: '고무나무를 키울 수 없어 수입해야 한다.' },
      { good: 'coffee', qty: 3, text: '커피 소비가 많은 나라이지만 환경적 요인으로 커피나무를 키울 수 없다.' },
    ],
  },
  purple: {
    name: '보라 나라', color: '#8440B8', ink: '#FFFFFF',
    rich: ['기술력이 높으며 특히 자동차 산업과 조선(배)산업이 발달했다.', '인구도 많아 경공업(옷 등)의 생산량이 많다.', '높은 기술력으로 컴퓨터도 만든다.'],
    startInventory: { clothes: 5, ship: 4, car: 8, computer: 3 },
    produces: ['clothes', 'ship', 'car', 'computer'],
    needs: [
      { good: 'rice',   qty: 6, text: '논과 밭이 없어 주식인 쌀을 대부분 수입한다.' },
      { good: 'coffee', qty: 4, text: '커피 소비량이 높은 편이나 지형적 요인으로 커피 재배가 불가능하다.' },
      { good: 'oil',    qty: 5, text: '지하자원(석유)이 부족하여 대부분 수입해야 한다.' },
    ],
  },
  pink: {
    name: '분홍 나라', color: '#E0428E', ink: '#FFFFFF',
    rich: ['노동력이 풍부하며 옷 공장이 많다.', '고도가 높은 지형이 있어 커피가 많이 재배된다.'],
    startInventory: { clothes: 5, coffee: 7 },
    produces: ['coffee', 'clothes'],
    needs: [
      { good: 'beef',   qty: 6, text: '인구가 많아 농축산물(소고기 등)에 대한 수요가 많다.' },
      { good: 'car',    qty: 3, text: '자동차 산업이 발달하지 않아 자동차를 수입한다.' },
      { good: 'banana', qty: 4, text: '열대기후가 아니기 때문에 열대과일(바나나 등)은 수입한다.' },
    ],
  },
};

// 돈 단위는 '억원'입니다. 10000 = 1조원
const SETTINGS = {
  startCash: 10000,     // 시작 국가 자산: 1조원
  levelBonus: 10000,    // 경제발전 1단계마다 +1조원
  maxPendingOffers: 8,  // 한 나라가 동시에 보낼 수 있는 제안 수
  stageNames: ['출발', '1단계 성장', '2단계 발전', '3단계 무역 강국'],
  // 시민 만족도 (0~100%): 무역이 소비자(시민)에게 주는 이익
  basePrice: 1000,        // 기준 가격: 물건 1개 = 1,000억원 (물물교환도 이 값으로 계산)
  satPerStage: 20,        // 부족 물건 문제를 해결할 때마다 +20% (3단계 = 60%)
  savingPerPoint: 100,    // 기준 가격보다 아낀 100억원마다 +1%
  satSavingMax: 40,       // 알뜰 수입으로 오를 수 있는 최대치 40%
};

module.exports = { GOODS, COUNTRIES, COUNTRY_ORDER, SETTINGS };
