import type { Fixture, Obstacle, ShelfRiskCategory, ShelfTier } from '../types';
import { isMerchandisable } from './fixtures';
import { HAND_Z, SHELF_RISK_PROFILES } from './optics';

export type ItemShape = 'cosmetic' | 'bottle' | 'card' | 'pouch' | 'can' | 'bulk';

export interface CravedScores {
  c: number; // Concealable - Dễ giấu
  r: number; // Removable - Dễ lấy/tháo
  a: number; // Available - Dễ tiếp cận
  v: number; // Valuable - Giá trị cao
  e: number; // Enjoyable - Nhu cầu/hấp dẫn
  d: number; // Disposable - Dễ tiêu thụ/bán lại
}

export interface GoodsProfile {
  id: string;
  label: string;
  category: Exclude<ShelfRiskCategory, 'custom'>;
  wmax: number;
  sizeHint: 'small' | 'medium' | 'large';
  shape: ItemShape;
  craved: CravedScores;
  colors: readonly [string, string];
}

export const CRAVED_AXES: { key: keyof CravedScores; code: string; name: string; hint: string }[] = [
  { key: 'c', code: 'C', name: 'Dễ giấu', hint: 'Concealable · nhỏ gọn dễ đút túi' },
  { key: 'r', code: 'R', name: 'Dễ lấy', hint: 'Removable · tháo/bóc nhanh bằng tay' },
  { key: 'a', code: 'A', name: 'Dễ với', hint: 'Available · bày mở tầm tay không khóa' },
  { key: 'v', code: 'V', name: 'Giá trị', hint: 'Valuable · đơn giá cao' },
  { key: 'e', code: 'E', name: 'Hấp dẫn', hint: 'Enjoyable · nhu cầu tiêu dùng cao' },
  { key: 'd', code: 'D', name: 'Dễ bán', hint: 'Disposable · dễ sang tay/tiêu thụ' },
];

export const GOODS_CATALOG: readonly GoodsProfile[] = [
  // CRAVED Cao
  {
    id: 'cosmetics',
    label: 'Mỹ phẩm / Son phấn',
    category: 'high',
    wmax: 4.7,
    sizeHint: 'small',
    shape: 'cosmetic',
    craved: { c: 5, r: 5, a: 4, v: 5, e: 5, d: 4 },
    colors: ['#b86d78', '#d79aa2'],
  },
  {
    id: 'alcohol-tobacco',
    label: 'Rượu ngoại / Thuốc lá',
    category: 'high',
    wmax: 4.8,
    sizeHint: 'small',
    shape: 'bottle',
    craved: { c: 4, r: 5, a: 4, v: 5, e: 5, d: 5 },
    colors: ['#7c5342', '#b98967'],
  },
  {
    id: 'accessories',
    label: 'Phụ kiện ĐT / Thẻ cào / Pin',
    category: 'high',
    wmax: 4.6,
    sizeHint: 'small',
    shape: 'card',
    craved: { c: 5, r: 5, a: 5, v: 4, e: 4, d: 5 },
    colors: ['#546e7a', '#8da4b0'],
  },
  {
    id: 'pharma-otc',
    label: 'Thuốc OTC / Thực phẩm CN',
    category: 'high',
    wmax: 4.5,
    sizeHint: 'small',
    shape: 'card',
    craved: { c: 5, r: 4, a: 4, v: 5, e: 4, d: 4 },
    colors: ['#4b7f78', '#89b7b0'],
  },
  {
    id: 'razors-personal',
    label: 'Dao cạo / Nước hoa mini',
    category: 'high',
    wmax: 4.5,
    sizeHint: 'small',
    shape: 'cosmetic',
    craved: { c: 5, r: 5, a: 5, v: 4, e: 4, d: 4 },
    colors: ['#706884', '#a89ec0'],
  },
  {
    id: 'milk-formula',
    label: 'Sữa bột / Đồ mẹ & bé',
    category: 'high',
    wmax: 4.3,
    sizeHint: 'medium',
    shape: 'can',
    craved: { c: 3, r: 4, a: 4, v: 5, e: 4, d: 5 },
    colors: ['#c9a96e', '#e5cfa1'],
  },

  // CRAVED Trung bình
  {
    id: 'snacks-candy',
    label: 'Bánh kẹo / Snack',
    category: 'standard',
    wmax: 3.4,
    sizeHint: 'medium',
    shape: 'pouch',
    craved: { c: 4, r: 4, a: 5, v: 2, e: 5, d: 3 },
    colors: ['#d4a15a', '#e3be84'],
  },
  {
    id: 'beverages',
    label: 'Nước giải khát / Bia lon',
    category: 'standard',
    wmax: 3.2,
    sizeHint: 'medium',
    shape: 'bottle',
    craved: { c: 3, r: 4, a: 5, v: 2, e: 5, d: 3 },
    colors: ['#6b9a95', '#a0c3be'],
  },
  {
    id: 'coffee-tea',
    label: 'Cà phê / Trà hộp',
    category: 'standard',
    wmax: 3.5,
    sizeHint: 'medium',
    shape: 'pouch',
    craved: { c: 3, r: 4, a: 4, v: 3, e: 4, d: 4 },
    colors: ['#8d6f52', '#bfa285'],
  },
  {
    id: 'fresh-food',
    label: 'Đồ ăn nhanh / Cơm hộp',
    category: 'standard',
    wmax: 3.3,
    sizeHint: 'medium',
    shape: 'pouch',
    craved: { c: 3, r: 5, a: 5, v: 2, e: 5, d: 2 },
    colors: ['#a9ba7b', '#c9d4a6'],
  },
  {
    id: 'home-care-small',
    label: 'Dầu gội / Chăm sóc cá nhân',
    category: 'standard',
    wmax: 3.1,
    sizeHint: 'medium',
    shape: 'can',
    craved: { c: 3, r: 4, a: 4, v: 3, e: 4, d: 3 },
    colors: ['#7c9bb0', '#adc4d4'],
  },
  {
    id: 'stationery',
    label: 'Văn phòng phẩm / Sách nhỏ',
    category: 'standard',
    wmax: 2.9,
    sizeHint: 'small',
    shape: 'card',
    craved: { c: 4, r: 4, a: 4, v: 2, e: 3, d: 3 },
    colors: ['#a4977d', '#cac0ab'],
  },

  // CRAVED Thấp / Cồng kềnh
  {
    id: 'detergent-jug',
    label: 'Nước giặt / Can lớn',
    category: 'bulky',
    wmax: 2.0,
    sizeHint: 'large',
    shape: 'bulk',
    craved: { c: 1, r: 2, a: 3, v: 2, e: 2, d: 2 },
    colors: ['#82a0a8', '#b1c6cc'],
  },
  {
    id: 'tissue-diapers',
    label: 'Giấy vệ sinh / Bỉm bịch to',
    category: 'bulky',
    wmax: 1.8,
    sizeHint: 'large',
    shape: 'bulk',
    craved: { c: 1, r: 2, a: 3, v: 2, e: 2, d: 2 },
    colors: ['#b7c2b0', '#d4dccf'],
  },
  {
    id: 'rice-grain',
    label: 'Gạo / Bao hàng lớn',
    category: 'bulky',
    wmax: 1.7,
    sizeHint: 'large',
    shape: 'bulk',
    craved: { c: 1, r: 1, a: 3, v: 2, e: 2, d: 2 },
    colors: ['#c0b397', '#ddd3be'],
  },
  {
    id: 'water-pack',
    label: 'Lốc nước / Thùng carton lớn',
    category: 'bulky',
    wmax: 1.6,
    sizeHint: 'large',
    shape: 'bulk',
    craved: { c: 1, r: 1, a: 3, v: 1, e: 3, d: 2 },
    colors: ['#8ea39d', '#b7c7c2'],
  },
];

export const GOODS_BY_ID = new Map(GOODS_CATALOG.map((item) => [item.id, item]));

const TIER_ZONE_NAMES = [
  'Sát chân',
  'Tầm tay',
  'Ngang ngực',
  'Ngang mắt',
  'Trên cao',
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function defaultGoodsByFixtureAndLevel(fixture: Fixture | undefined, tierIndex: number, tierCount: number, fallbackCat: ShelfRiskCategory): string[] {
  const isTop = tierIndex === tierCount - 1;
  const isBottom = tierIndex === 0;
  if (fixture === 'locked-cabinet') {
    return isTop ? ['alcohol-tobacco'] : isBottom ? ['milk-formula'] : ['cosmetics', 'accessories'];
  }
  if (fixture === 'checkout-rack') {
    return isTop ? ['accessories'] : ['snacks-candy'];
  }
  if (fixture === 'fridge') {
    return isBottom ? ['water-pack'] : isTop ? ['milk-formula'] : ['beverages', 'fresh-food'];
  }
  if (fixture === 'freezer') {
    return isBottom ? ['water-pack'] : ['fresh-food'];
  }
  if (fixture === 'food-counter') {
    return ['fresh-food', 'beverages'];
  }
  if (fixture === 'endcap' || fixture === 'promo-island') {
    return fallbackCat === 'high' ? ['cosmetics', 'snacks-candy'] : isBottom ? ['water-pack'] : ['snacks-candy', 'beverages'];
  }
  if (fallbackCat === 'high') {
    return isBottom ? ['home-care-small'] : isTop ? ['cosmetics'] : ['razors-personal', 'accessories'];
  }
  if (fallbackCat === 'bulky') {
    return isBottom ? ['rice-grain'] : isTop ? ['tissue-diapers'] : ['detergent-jug'];
  }
  return isBottom ? ['water-pack'] : isTop ? ['coffee-tea'] : ['snacks-candy', 'home-care-small'];
}

export function tierCountForObstacle(obstacle: Pick<Obstacle, 'elev' | 'fixture'>): number {
  if (obstacle.fixture === 'freezer') return 2;
  if (obstacle.elev <= 1.0) return 2;
  if (obstacle.elev <= 1.35) return 3;
  if (obstacle.elev >= 2.15) return 5;
  return 4;
}

/** Build ordered vertical shelf tiers from floor (`t1`) to top (`tN`). */
export function defaultTiersForObstacle(obstacle: Pick<Obstacle, 'type' | 'fixture' | 'elev' | 'riskCategory'>): ShelfTier[] {
  if (!isMerchandisable(obstacle)) return [];
  const count = tierCountForObstacle(obstacle);
  const elev = Math.max(0.4, obstacle.elev || 1.5);
  const baseOffset = obstacle.fixture === 'freezer' ? 0.15 : Math.min(0.12, elev * 0.08);
  const span = Math.max(0.25, elev - baseOffset);
  const step = span / count;
  const fallbackCat = obstacle.riskCategory ?? 'standard';
  const nameTable = count === 2
    ? ['Ngăn dưới', 'Ngăn trên']
    : count === 3
      ? ['Tầng dưới', 'Tầm tay', 'Tầng trên']
      : count === 4
        ? ['Sát chân', 'Tầm tay', 'Ngang mắt', 'Trên cao']
        : TIER_ZONE_NAMES;

  return Array.from({ length: count }, (_, idx) => {
    const zMin = round2(idx === 0 ? baseOffset : baseOffset + idx * step);
    const zMax = round2(idx === count - 1 ? elev : baseOffset + (idx + 1) * step);
    return {
      id: `t${idx + 1}`,
      name: `Tầng ${idx + 1} · ${nameTable[idx] ?? `Mức ${idx + 1}`}`,
      zMin,
      zMax,
      goodsIds: defaultGoodsByFixtureAndLevel(obstacle.fixture, idx, count, fallbackCat),
    };
  });
}

export function rescaleTiersToElevation(tiers: ShelfTier[], elev: number): ShelfTier[] {
  if (!tiers.length) return [];
  const count = tiers.length;
  const safeElev = Math.max(0.4, elev);
  const baseOffset = Math.min(0.12, safeElev * 0.08);
  const span = Math.max(0.25, safeElev - baseOffset);
  const step = span / count;
  return tiers.map((tier, idx) => ({
    ...tier,
    zMin: round2(idx === 0 ? baseOffset : baseOffset + idx * step),
    zMax: round2(idx === count - 1 ? safeElev : baseOffset + (idx + 1) * step),
  }));
}

export interface TierAnalysis {
  tier: ShelfTier;
  goods: GoodsProfile[];
  category: Exclude<ShelfRiskCategory, 'custom'>;
  wmax: number;
  craved: CravedScores;
  isHandZone: boolean;
  handRiskAlert: boolean;
}

export function analyzeTierCraved(tier: ShelfTier): TierAnalysis {
  const goods = tier.goodsIds.map((id) => GOODS_BY_ID.get(id)).filter((g): g is GoodsProfile => Boolean(g));
  const effective = goods.length ? goods : [GOODS_CATALOG[6]]; // snacks fallback
  const maxW = Math.max(...effective.map((g) => g.wmax));
  const avgW = effective.reduce((s, g) => s + g.wmax, 0) / effective.length;
  const wmax = Math.round((0.7 * maxW + 0.3 * avgW) * 10) / 10;
  const category: Exclude<ShelfRiskCategory, 'custom'> = wmax >= 4 ? 'high' : wmax >= 2.4 ? 'standard' : 'bulky';
  const craved: CravedScores = {
    c: Math.max(...effective.map((g) => g.craved.c)),
    r: Math.max(...effective.map((g) => g.craved.r)),
    a: Math.max(...effective.map((g) => g.craved.a)),
    v: Math.max(...effective.map((g) => g.craved.v)),
    e: Math.max(...effective.map((g) => g.craved.e)),
    d: Math.max(...effective.map((g) => g.craved.d)),
  };
  const isHandZone = tier.zMin <= HAND_Z + 0.05;
  const handRiskAlert = isHandZone && effective.some((g) => g.category === 'high' || (g.sizeHint === 'small' && g.wmax >= 3.4));
  return { tier, goods: effective, category, wmax, craved, isHandZone, handRiskAlert };
}

export interface ObstacleCravedAnalysis {
  tiers: ShelfTier[];
  tierAnalyses: TierAnalysis[];
  category: Exclude<ShelfRiskCategory, 'custom'>;
  wmax: number;
  craved: CravedScores;
  handAlertCount: number;
}

export function analyzeObstacleCraved(obstacle: Obstacle): ObstacleCravedAnalysis {
  const tiers = obstacle.tiers?.length ? obstacle.tiers : defaultTiersForObstacle(obstacle);
  if (!tiers.length) {
    const fallbackCat = obstacle.riskCategory && obstacle.riskCategory !== 'custom' ? obstacle.riskCategory : 'bulky';
    const wmax = obstacle.riskWmax ?? SHELF_RISK_PROFILES[fallbackCat].wmax;
    return {
      tiers: [],
      tierAnalyses: [],
      category: fallbackCat,
      wmax,
      craved: { c: 1, r: 1, a: 2, v: 2, e: 1, d: 1 },
      handAlertCount: 0,
    };
  }
  const tierAnalyses = tiers.map(analyzeTierCraved);
  const maxTierW = Math.max(...tierAnalyses.map((t) => t.wmax));
  const avgTierW = tierAnalyses.reduce((s, t) => s + t.wmax, 0) / tierAnalyses.length;
  // Highlight the shelf by its highest-risk merchandise (75% peak + 25% shelf average)
  const wmax = Math.max(1.2, Math.min(5, Math.round((0.75 * maxTierW + 0.25 * avgTierW) * 10) / 10));
  const category: Exclude<ShelfRiskCategory, 'custom'> = wmax >= 4 ? 'high' : wmax >= 2.4 ? 'standard' : 'bulky';
  const craved: CravedScores = {
    c: Math.max(...tierAnalyses.map((t) => t.craved.c)),
    r: Math.max(...tierAnalyses.map((t) => t.craved.r)),
    a: Math.max(...tierAnalyses.map((t) => t.craved.a)),
    v: Math.max(...tierAnalyses.map((t) => t.craved.v)),
    e: Math.max(...tierAnalyses.map((t) => t.craved.e)),
    d: Math.max(...tierAnalyses.map((t) => t.craved.d)),
  };
  const handAlertCount = tierAnalyses.filter((t) => t.handRiskAlert).length;
  return { tiers, tierAnalyses, category, wmax, craved, handAlertCount };
}

export function applyTiersToObstacle(obstacle: Obstacle, tiers: ShelfTier[], preserveCustom = false): Partial<Obstacle> {
  const analysis = analyzeObstacleCraved({ ...obstacle, tiers });
  if (preserveCustom && obstacle.riskCategory === 'custom') {
    return { tiers };
  }
  return {
    tiers,
    riskCategory: analysis.category,
    riskWmax: analysis.wmax,
  };
}
