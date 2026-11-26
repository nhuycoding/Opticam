import { useState } from 'react';
import { AlertTriangle, Check, CopyCheck, Layers } from 'lucide-react';
import type { Obstacle, ShelfRiskCategory, ShelfTier } from '../types';
import {
  analyzeObstacleCraved,
  CRAVED_AXES,
  defaultTiersForObstacle,
  GOODS_CATALOG,
} from '../core/craved';

interface Props {
  obstacle: Obstacle;
  onChangeTiers: (tiers: ShelfTier[], preserveCustom?: boolean) => void;
}

const BAND_LABEL: Record<Exclude<ShelfRiskCategory, 'custom'>, string> = {
  high: 'CRAVED Cao',
  standard: 'Trung bình',
  bulky: 'Cồng kềnh',
};

const GROUP_TABS: { key: Exclude<ShelfRiskCategory, 'custom'>; label: string }[] = [
  { key: 'high', label: 'Cao (4.3–4.8)' },
  { key: 'standard', label: 'Vừa (2.9–3.5)' },
  { key: 'bulky', label: 'Thấp (1.6–2.0)' },
];

export function ShelfTierFolders({ obstacle, onChangeTiers }: Props) {
  const analysis = analyzeObstacleCraved(obstacle);
  const { tiers, tierAnalyses, category, wmax, craved, handAlertCount } = analysis;

  // Top-most shelf tier sits at the top of the folder stack (physically intuitive top -> floor).
  const displayOrder = [...tierAnalyses].reverse();
  const [openTierId, setOpenTierId] = useState<string>(() => displayOrder[1]?.tier.id ?? displayOrder[0]?.tier.id ?? 't1');
  const activeTierAnalysis = tierAnalyses.find((t) => t.tier.id === openTierId) ?? displayOrder[0];

  const [goodsFilter, setGoodsFilter] = useState<Exclude<ShelfRiskCategory, 'custom'>>(
    () => activeTierAnalysis?.category ?? 'high'
  );
  const [multiMode, setMultiMode] = useState(false);

  if (!tiers.length) return null;

  const handleGoodClick = (tierId: string, goodId: string, shiftKey: boolean) => {
    const next = tiers.map((tier) => {
      if (tier.id !== tierId) return tier;
      const exists = tier.goodsIds.includes(goodId);
      if (multiMode || shiftKey) {
        if (exists) {
          return tier.goodsIds.length > 1
            ? { ...tier, goodsIds: tier.goodsIds.filter((id) => id !== goodId) }
            : tier;
        }
        return { ...tier, goodsIds: [...tier.goodsIds, goodId] };
      }
      return { ...tier, goodsIds: [goodId] };
    });
    onChangeTiers(next);
  };

  const removeGoodFromTier = (tierId: string, goodId: string) => {
    const next = tiers.map((tier) => {
      if (tier.id !== tierId || tier.goodsIds.length <= 1) return tier;
      return { ...tier, goodsIds: tier.goodsIds.filter((id) => id !== goodId) };
    });
    onChangeTiers(next);
  };

  const applyTierGoodsToAll = (goodsIds: string[]) => {
    const next = tiers.map((tier) => ({ ...tier, goodsIds: [...goodsIds] }));
    onChangeTiers(next);
  };

  const resetDefaultTiers = () => {
    onChangeTiers(defaultTiersForObstacle(obstacle), false);
  };

  const filteredGoods = GOODS_CATALOG.filter((item) => item.category === goodsFilter);

  return (
    <div className="tier-folders-wrap">
      <div className="tier-folders-head">
        <span><Layers size={13} /> Tầng kệ &amp; Hàng hóa ({tiers.length} tầng)</span>
        <button type="button" className="text-button tier-reset-btn" onClick={resetDefaultTiers}>
          Mặc định theo kệ
        </button>
      </div>

      <div className="folder-stack" role="tablist" aria-label="Các tầng trên kệ">
        {displayOrder.map((ta, idx) => {
          const isOpen = ta.tier.id === activeTierAnalysis?.tier.id;
          const primaryLabel = ta.goods[0]?.label ?? 'Chưa chọn';
          const extraCount = ta.goods.length > 1 ? ` +${ta.goods.length - 1}` : '';
          return (
            <div
              key={ta.tier.id}
              className={`folder-item folder-${ta.category}${isOpen ? ' open' : ''}`}
              style={{ zIndex: isOpen ? tiers.length + 2 : tiers.length - idx }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isOpen}
                className="folder-tab"
                onClick={() => {
                  setOpenTierId(ta.tier.id);
                  setGoodsFilter(ta.category);
                }}
              >
                <span className="folder-tab-left">
                  <i className={`folder-strip strip-${ta.category}`} aria-hidden="true" />
                  <span className="folder-title-group">
                    <strong>{ta.tier.name}</strong>
                    <small>{ta.tier.zMin.toFixed(2)}–{ta.tier.zMax.toFixed(2)} m{ta.isHandZone ? ' · Tầm tay' : ''}</small>
                  </span>
                </span>
                <span className="folder-tab-right">
                  {ta.handRiskAlert && (
                    <span className="folder-hand-warn" title="Hàng dễ giấu/giá trị cao đặt ở tầm tay ≤ 1.0 m">
                      <AlertTriangle size={11} />
                    </span>
                  )}
                  <span className="folder-goods-preview">{primaryLabel}{extraCount}</span>
                  <span className={`craved-pill pill-${ta.category}`}>W {ta.wmax.toFixed(1)}</span>
                </span>
              </button>

              {isOpen && (
                <div className="folder-body" role="tabpanel" aria-label={ta.tier.name}>
                  {ta.handRiskAlert && (
                    <div className="tier-hand-alert">
                      <AlertTriangle size={13} />
                      <span>Tầng tầm tay (≤ 1.0 m) chứa hàng nhỏ/CRAVED cao — dễ bị khuất sau kệ khác nếu không bật <b>Chống khuất tầm tay</b>.</span>
                    </div>
                  )}

                  <div className="tier-active-goods">
                    <span className="tier-active-label">Đang bày:</span>
                    {ta.goods.map((g) => (
                      <span key={g.id} className="tier-active-tag">
                        <i style={{ background: g.colors[0] }} />
                        {g.label}
                        {ta.goods.length > 1 && (
                          <button type="button" aria-label={`Bỏ ${g.label}`} onClick={() => removeGoodFromTier(ta.tier.id, g.id)}>×</button>
                        )}
                      </span>
                    ))}
                    <label className="tier-multi-toggle" title="Bật để chọn nhiều loại hàng cùng tầng">
                      <input type="checkbox" checked={multiMode} onChange={(e) => setMultiMode(e.target.checked)} />
                      <span>Ghép món</span>
                    </label>
                  </div>

                  <div className="goods-filter-bar" role="group" aria-label="Nhóm CRAVED hàng hóa">
                    {GROUP_TABS.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={`goods-filter-tab${goodsFilter === tab.key ? ` active tab-${tab.key}` : ''}`}
                        onClick={() => setGoodsFilter(tab.key)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="goods-chip-grid">
                    {filteredGoods.map((good) => {
                      const selected = ta.tier.goodsIds.includes(good.id);
                      return (
                        <button
                          key={good.id}
                          type="button"
                          className={`goods-chip${selected ? ' selected' : ''}`}
                          onClick={(event) => handleGoodClick(ta.tier.id, good.id, Boolean(event?.shiftKey))}
                          title={multiMode ? `Thêm/bỏ ${good.label} (Wmax ${good.wmax})` : `Đặt ${good.label} lên tầng (Shift+Click để ghép thêm)`}
                        >
                          <span className="goods-chip-dot" style={{ background: good.colors[0] }} />
                          <span className="goods-chip-label">{good.label}</span>
                          {selected ? <Check size={11} /> : <small>{good.wmax}</small>}
                        </button>
                      );
                    })}
                  </div>

                  <div className="tier-craved-row">
                    <div className="craved-bars" aria-label="Chỉ số CRAVED của tầng">
                      {CRAVED_AXES.map((axis) => (
                        <div key={axis.key} className="craved-bar-cell" title={`${axis.code} · ${axis.name}: ${ta.craved[axis.key]}/5 (${axis.hint})`}>
                          <span>{axis.code}</span>
                          <i className="craved-bar-track"><em style={{ width: `${(ta.craved[axis.key] / 5) * 100}%` }} /></i>
                          <small>{ta.craved[axis.key]}</small>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="apply-all-tiers-btn"
                      onClick={() => applyTierGoodsToAll(ta.tier.goodsIds)}
                      title="Dùng loại hàng của tầng này cho toàn bộ các tầng trên kệ"
                    >
                      <CopyCheck size={12} /> Áp dụng cả kệ
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="craved-summary-card">
        <div className="craved-summary-head">
          <div>
            <small>Phân loại CRAVED toàn kệ</small>
            <strong>{BAND_LABEL[category]} · W<sub>max</sub> = {wmax.toFixed(1)}</strong>
          </div>
          <span className={`craved-pill pill-${category}`}>
            {obstacle.riskCategory === 'custom' ? 'Đang chỉnh tay' : BAND_LABEL[category]}
          </span>
        </div>
        <div className="craved-bars compact">
          {CRAVED_AXES.map((axis) => (
            <div key={axis.key} className="craved-bar-cell" title={`${axis.code} (${axis.name}): ${craved[axis.key]}/5`}>
              <span>{axis.code}</span>
              <i className="craved-bar-track"><em style={{ width: `${(craved[axis.key] / 5) * 100}%` }} /></i>
              <small>{craved[axis.key]}</small>
            </div>
          ))}
        </div>
        {handAlertCount > 0 && (
          <p className="craved-summary-note">
            Có <b>{handAlertCount}</b> tầng tầm tay (≤ 1.0 m) bày hàng rủi ro cao — tự động ưu tiên mức <b>{BAND_LABEL[category]}</b> trên bản đồ.
          </p>
        )}
      </div>
    </div>
  );
}
