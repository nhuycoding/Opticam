import type { Fixture, ObsType, Obstacle, ShelfRiskCategory } from '../types';

export type FixtureGroup = 'display' | 'cold' | 'service' | 'structure';

export interface SizePreset {
  tag: 'S' | 'M' | 'L';
  label: string;
  w: number;
  h: number;
  elev: number;
}

export interface FixtureSpec {
  label: string;
  group: FixtureGroup;
  w: number;
  h: number;
  elev: number;
  placement: 'wall' | 'near-wall' | 'aisle';
  merchandisable: boolean;
  defaultRiskCategory: Exclude<ShelfRiskCategory, 'custom'>;
  defaultWmax?: number;
  presets: readonly SizePreset[];
}

export const FIXTURE_VALUES = [
  'gondola',
  'wall-shelf',
  'endcap',
  'promo-island',
  'checkout-rack',
  'fridge',
  'freezer',
  'locked-cabinet',
  'food-counter',
  'seating',
  'locker',
  'partition',
  'column',
] as const satisfies readonly Fixture[];

export const FIXTURE_GROUP_LABELS: Record<FixtureGroup, string> = {
  display: 'Kệ trưng bày',
  cold: 'Tủ lạnh & Tủ khóa',
  service: 'Quầy & Dịch vụ',
  structure: 'Kiến trúc & Kho',
};

export const FIXTURE_SPECS: Record<Fixture, FixtureSpec> = {
  gondola: {
    label: 'Kệ hai mặt',
    group: 'display',
    w: 2.4,
    h: 0.8,
    elev: 1.5,
    placement: 'aisle',
    merchandisable: true,
    defaultRiskCategory: 'standard',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 1.4, h: 0.7, elev: 1.4 },
      { tag: 'M', label: 'Chuẩn', w: 2.4, h: 0.8, elev: 1.5 },
      { tag: 'L', label: 'Lớn', w: 3.6, h: 0.9, elev: 1.8 },
    ],
  },
  'wall-shelf': {
    label: 'Kệ một mặt sát tường',
    group: 'display',
    w: 2.4,
    h: 0.45,
    elev: 1.8,
    placement: 'wall',
    merchandisable: true,
    defaultRiskCategory: 'standard',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 1.2, h: 0.4, elev: 1.6 },
      { tag: 'M', label: 'Chuẩn', w: 2.4, h: 0.45, elev: 1.8 },
      { tag: 'L', label: 'Lớn', w: 3.6, h: 0.5, elev: 2.1 },
    ],
  },
  endcap: {
    label: 'Kệ đầu dãy',
    group: 'display',
    w: 0.9,
    h: 0.45,
    elev: 1.5,
    placement: 'aisle',
    merchandisable: true,
    defaultRiskCategory: 'high',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 0.7, h: 0.4, elev: 1.35 },
      { tag: 'M', label: 'Chuẩn', w: 0.9, h: 0.45, elev: 1.5 },
      { tag: 'L', label: 'Lớn', w: 1.2, h: 0.5, elev: 1.65 },
    ],
  },
  'promo-island': {
    label: 'Đảo khuyến mãi',
    group: 'display',
    w: 1.2,
    h: 1.2,
    elev: 1.15,
    placement: 'aisle',
    merchandisable: true,
    defaultRiskCategory: 'standard',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 0.9, h: 0.9, elev: 1.0 },
      { tag: 'M', label: 'Chuẩn', w: 1.2, h: 1.2, elev: 1.15 },
      { tag: 'L', label: 'Lớn', w: 1.6, h: 1.2, elev: 1.25 },
    ],
  },
  'checkout-rack': {
    label: 'Kệ trước thu ngân',
    group: 'display',
    w: 1.4,
    h: 0.35,
    elev: 1.15,
    placement: 'near-wall',
    merchandisable: true,
    defaultRiskCategory: 'high',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 1.0, h: 0.35, elev: 1.05 },
      { tag: 'M', label: 'Chuẩn', w: 1.4, h: 0.35, elev: 1.15 },
      { tag: 'L', label: 'Lớn', w: 2.0, h: 0.4, elev: 1.25 },
    ],
  },
  fridge: {
    label: 'Tủ mát',
    group: 'cold',
    w: 2.0,
    h: 0.7,
    elev: 2.1,
    placement: 'near-wall',
    merchandisable: true,
    defaultRiskCategory: 'standard',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 1.2, h: 0.65, elev: 2.0 },
      { tag: 'M', label: 'Chuẩn', w: 2.0, h: 0.7, elev: 2.1 },
      { tag: 'L', label: 'Lớn', w: 2.8, h: 0.75, elev: 2.15 },
    ],
  },
  freezer: {
    label: 'Tủ đông',
    group: 'cold',
    w: 1.6,
    h: 0.8,
    elev: 0.9,
    placement: 'near-wall',
    merchandisable: true,
    defaultRiskCategory: 'standard',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 1.1, h: 0.7, elev: 0.85 },
      { tag: 'M', label: 'Chuẩn', w: 1.6, h: 0.8, elev: 0.9 },
      { tag: 'L', label: 'Lớn', w: 2.2, h: 0.9, elev: 0.95 },
    ],
  },
  'locked-cabinet': {
    label: 'Tủ kính khóa (Hàng giá trị)',
    group: 'cold',
    w: 1.5,
    h: 0.5,
    elev: 2.0,
    placement: 'near-wall',
    merchandisable: true,
    defaultRiskCategory: 'high',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 1.0, h: 0.45, elev: 1.85 },
      { tag: 'M', label: 'Chuẩn', w: 1.5, h: 0.5, elev: 2.0 },
      { tag: 'L', label: 'Lớn', w: 2.2, h: 0.55, elev: 2.1 },
    ],
  },
  'food-counter': {
    label: 'Quầy đồ ăn / pha chế',
    group: 'service',
    w: 2.0,
    h: 0.75,
    elev: 1.05,
    placement: 'near-wall',
    merchandisable: true,
    defaultRiskCategory: 'standard',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 1.4, h: 0.7, elev: 1.0 },
      { tag: 'M', label: 'Chuẩn', w: 2.0, h: 0.75, elev: 1.05 },
      { tag: 'L', label: 'Lớn', w: 2.8, h: 0.85, elev: 1.1 },
    ],
  },
  seating: {
    label: 'Bàn ngồi',
    group: 'service',
    w: 1.8,
    h: 0.65,
    elev: 0.8,
    placement: 'near-wall',
    merchandisable: false,
    defaultRiskCategory: 'bulky',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 1.2, h: 0.6, elev: 0.75 },
      { tag: 'M', label: 'Chuẩn', w: 1.8, h: 0.65, elev: 0.8 },
      { tag: 'L', label: 'Lớn', w: 2.4, h: 0.75, elev: 0.8 },
    ],
  },
  locker: {
    label: 'Tủ gửi đồ / Kho mini',
    group: 'structure',
    w: 1.4,
    h: 0.45,
    elev: 1.8,
    placement: 'near-wall',
    merchandisable: false,
    defaultRiskCategory: 'standard',
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 0.9, h: 0.45, elev: 1.6 },
      { tag: 'M', label: 'Chuẩn', w: 1.4, h: 0.45, elev: 1.8 },
      { tag: 'L', label: 'Lớn', w: 2.0, h: 0.5, elev: 1.9 },
    ],
  },
  partition: {
    label: 'Vách ngăn',
    group: 'structure',
    w: 2.0,
    h: 0.2,
    elev: 2.4,
    placement: 'aisle',
    merchandisable: false,
    defaultRiskCategory: 'bulky',
    defaultWmax: 1.2,
    presets: [
      { tag: 'S', label: 'Ngắn', w: 1.2, h: 0.15, elev: 2.2 },
      { tag: 'M', label: 'Chuẩn', w: 2.0, h: 0.2, elev: 2.4 },
      { tag: 'L', label: 'Cao kịch trần', w: 3.0, h: 0.2, elev: 3.0 },
    ],
  },
  column: {
    label: 'Cột kiến trúc',
    group: 'structure',
    w: 0.4,
    h: 0.4,
    elev: 3.0,
    placement: 'aisle',
    merchandisable: false,
    defaultRiskCategory: 'bulky',
    defaultWmax: 1.0,
    presets: [
      { tag: 'S', label: 'Nhỏ', w: 0.3, h: 0.3, elev: 3.0 },
      { tag: 'M', label: 'Chuẩn', w: 0.4, h: 0.4, elev: 3.0 },
      { tag: 'L', label: 'Lớn', w: 0.6, h: 0.6, elev: 3.0 },
    ],
  },
};

export const BASE_OBSTACLE_PRESETS: Record<'pos' | 'entrance', readonly SizePreset[]> = {
  pos: [
    { tag: 'S', label: 'Nhỏ', w: 1.5, h: 0.85, elev: 1.05 },
    { tag: 'M', label: 'Chuẩn', w: 2.0, h: 1.0, elev: 1.1 },
    { tag: 'L', label: 'Đôi / Lớn', w: 2.8, h: 1.05, elev: 1.15 },
  ],
  entrance: [
    { tag: 'S', label: 'Cửa đơn', w: 1.0, h: 0.2, elev: 2.2 },
    { tag: 'M', label: 'Chuẩn', w: 1.5, h: 0.2, elev: 2.2 },
    { tag: 'L', label: 'Cửa đôi', w: 2.2, h: 0.2, elev: 2.4 },
  ],
};

export interface CatalogEntry {
  key: string;
  label: string;
  group: FixtureGroup;
  type: ObsType;
  fixture?: Fixture;
}

export const FURNITURE_CATALOG: readonly CatalogEntry[] = [
  { key: 'gondola', label: FIXTURE_SPECS.gondola.label, group: 'display', type: 'shelf', fixture: 'gondola' },
  { key: 'wall-shelf', label: FIXTURE_SPECS['wall-shelf'].label, group: 'display', type: 'shelf', fixture: 'wall-shelf' },
  { key: 'endcap', label: FIXTURE_SPECS.endcap.label, group: 'display', type: 'shelf', fixture: 'endcap' },
  { key: 'promo-island', label: FIXTURE_SPECS['promo-island'].label, group: 'display', type: 'shelf', fixture: 'promo-island' },
  { key: 'checkout-rack', label: FIXTURE_SPECS['checkout-rack'].label, group: 'display', type: 'shelf', fixture: 'checkout-rack' },
  { key: 'fridge', label: FIXTURE_SPECS.fridge.label, group: 'cold', type: 'shelf', fixture: 'fridge' },
  { key: 'freezer', label: FIXTURE_SPECS.freezer.label, group: 'cold', type: 'shelf', fixture: 'freezer' },
  { key: 'locked-cabinet', label: FIXTURE_SPECS['locked-cabinet'].label, group: 'cold', type: 'shelf', fixture: 'locked-cabinet' },
  { key: 'pos', label: 'Quầy thu ngân POS', group: 'service', type: 'pos' },
  { key: 'food-counter', label: FIXTURE_SPECS['food-counter'].label, group: 'service', type: 'shelf', fixture: 'food-counter' },
  { key: 'seating', label: FIXTURE_SPECS.seating.label, group: 'service', type: 'shelf', fixture: 'seating' },
  { key: 'entrance', label: 'Cửa ra vào', group: 'structure', type: 'entrance' },
  { key: 'locker', label: FIXTURE_SPECS.locker.label, group: 'structure', type: 'shelf', fixture: 'locker' },
  { key: 'partition', label: FIXTURE_SPECS.partition.label, group: 'structure', type: 'shelf', fixture: 'partition' },
  { key: 'column', label: FIXTURE_SPECS.column.label, group: 'structure', type: 'shelf', fixture: 'column' },
];

export function isFixtureName(value: unknown): value is Fixture {
  return typeof value === 'string' && (FIXTURE_VALUES as readonly string[]).includes(value);
}

export function sizePresetsForObstacle(obstacle: Pick<Obstacle, 'type' | 'fixture'>, ceilingHeight = 3.2): readonly SizePreset[] {
  const raw = obstacle.type === 'shelf'
    ? FIXTURE_SPECS[obstacle.fixture ?? 'gondola'].presets
    : BASE_OBSTACLE_PRESETS[obstacle.type];
  return raw.map((preset) => ({
    ...preset,
    elev: Math.min(preset.elev, ceilingHeight),
  }));
}

export function isMerchandisable(obstacle: Pick<Obstacle, 'type' | 'fixture'>): boolean {
  if (obstacle.type !== 'shelf') return false;
  return FIXTURE_SPECS[obstacle.fixture ?? 'gondola'].merchandisable;
}
