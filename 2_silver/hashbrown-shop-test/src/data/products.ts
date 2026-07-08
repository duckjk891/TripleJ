export interface Product {
  id: string;
  name: string;
  category: '보행 보조' | '휠체어' | '욕실 안전' | '건강 관리';
  price: number;
  description: string;
  emoji: string;
  stock: number;
}

export const PRODUCTS: Product[] = [
  {
    id: 'cane-01',
    name: '4발 안전 지팡이',
    category: '보행 보조',
    price: 25000,
    description: '바닥 지지점이 4개라 혼자 서 있어도 넘어지지 않는 안정형 지팡이. 높이 조절 가능.',
    emoji: '🦯',
    stock: 12,
  },
  {
    id: 'cane-02',
    name: '접이식 알루미늄 지팡이',
    category: '보행 보조',
    price: 18000,
    description: '가볍고 4단으로 접혀 가방에 넣기 좋은 외출용 지팡이.',
    emoji: '🦯',
    stock: 30,
  },
  {
    id: 'walker-01',
    name: '보행보조차 (실버카)',
    category: '보행 보조',
    price: 95000,
    description: '앉아서 쉴 수 있는 의자와 장바구니가 달린 4바퀴 보행보조차. 브레이크 장착.',
    emoji: '🛒',
    stock: 8,
  },
  {
    id: 'wheelchair-01',
    name: '수동 휠체어 (경량형)',
    category: '휠체어',
    price: 180000,
    description: '11kg 경량 알루미늄 프레임, 접이식이라 차 트렁크에 실을 수 있는 수동 휠체어.',
    emoji: '🦽',
    stock: 5,
  },
  {
    id: 'wheelchair-02',
    name: '전동 휠체어',
    category: '휠체어',
    price: 1450000,
    description: '한 번 충전으로 20km 주행 가능한 전동 휠체어. 조이스틱 조작, 안전벨트 포함.',
    emoji: '🦼',
    stock: 2,
  },
  {
    id: 'grab-01',
    name: '욕실 안전손잡이',
    category: '욕실 안전',
    price: 15000,
    description: '욕조·변기 옆 벽면에 설치하는 미끄럼 방지 스테인리스 손잡이 (38cm).',
    emoji: '🚿',
    stock: 40,
  },
  {
    id: 'bath-01',
    name: '목욕의자 (미끄럼 방지)',
    category: '욕실 안전',
    price: 32000,
    description: '높이 조절이 되는 미끄럼 방지 목욕의자. 등받이가 있어 편하게 앉아 씻을 수 있음.',
    emoji: '🛁',
    stock: 15,
  },
  {
    id: 'bp-01',
    name: '자동 혈압계',
    category: '건강 관리',
    price: 45000,
    description: '팔뚝형 자동 전자 혈압계. 큰 글씨 화면과 음성 안내로 어르신도 쉽게 사용.',
    emoji: '🩺',
    stock: 20,
  },
];

export const formatPrice = (price: number) => `${price.toLocaleString('ko-KR')}원`;
