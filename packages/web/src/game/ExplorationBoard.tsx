/**
 * 探索板（Lost Fleet 各族专属飞船面板，实图版）：
 * 面板整图（用户自拍抠图，factions/panels/<id>.png）+ 底部 3 个穿梭机槽位叠加
 * （panel-calibration 相对坐标，全族同模板）：未派遣显示穿梭机图，
 * 已派遣留空（tooltip 标明去向飞船）。
 * 派遣费用（5 VP，Bal T'aks 7 VP）与种族增强/削弱为面板印刷内容；
 * 规则文本版调整说明放在 tooltip（FACTION_ADJUST）。
 * 仅 lostFleet 启用时渲染。
 */
import type { ReactElement } from 'react';
import type { FactionId, PlayerIndex } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import { SHUTTLE_IMAGE, boosterImage, factionPanelImage } from '../assets';
import { boosterName, factionName, shipName } from './display';
import { PANEL_SHUTTLE_SLOTS, PANEL_SHUTTLE_W, PANEL_SLOT_OFFSET_2P } from './panel-calibration';

/** 各族探索板调整文本（增强/削弱，按规则书 p16 与族能力；实图面板上为图标，文本进 tooltip）。 */
const FACTION_ADJUST: Record<FactionId, string> = {
  terrans: '盖亚轨 L1 起步；盖亚碗 token 每轮全部回碗 II（增强）',
  lantids: 'PI：可在对手已殖民星球放附加矿；1-3 人局 PI 覆盖板增强',
  xenos: '第 3 个起始矿（增强）',
  gleens: '每颗盖亚星 +2vp；无 QIC 收入（削弱）',
  taklons: '脑石（每充能 ≈1o/3c；绝不留碗 III 过夜）',
  ambas: '导航轨 L1 起步；每轮 1 次矿↔贸易站互换（增强）',
  'hadsch-hallas': '起始信用收入全场最佳；PI 可换资源（增强）',
  ivits: '无起始矿（改放 PI + 空间站）；I/II 区各仅 2 电力（削弱）',
  geodens: 'PI 后每种新星球类型 +3 知识（增强）',
  baltaks: '派遣穿梭机 7 VP（削弱，贵 2）；盖亚机可换 QIC（增强）',
  firaks: 'PI 升降机：实验室↔贸易站每轮 1 次（增强）',
  bescods: '每轮免费爬最低轨 1 级；起始 3 知识（增强）',
  nevlas: '魔力即资源（充能当钱花）；4 充能片是命门',
  itars: '盖亚碗 4 token → 1 科技片（每局 4-5 次，增强）',
  tinkeroids: '出生带 PI；Tinkering tiles（每轮 1 次免费板块，增强）',
  darkanians: '双 L1 轨起步；全行星 1 步改造；无母星（盖亚星 2 QIC，削弱）',
  moweyds: 'Power Rings；3vp/联邦片可刷 40+（增强）',
  'space-giants': '每轮免费 1 步改造（增强）；盖亚形成向',
};

export interface ExplorationBoardProps {
  state: FilteredState;
  seat: PlayerIndex;
}

/**
 * 版图右侧竖列：种族飞船面板（上，撑满剩余高度）+ 当回合助推片（下，高 = --booster-h
 * = 版图高一半）。非 LF 局面板不渲染、助推片仍在（标准局同样有助推片）。
 */
export function PanelBoosterStack({ state, seat }: ExplorationBoardProps): ReactElement {
  const p = state.players[seat];
  return (
    <div className="panel-booster-stack" data-testid={`panel-booster-stack-${seat}`}>
      <ExplorationBoard state={state} seat={seat} />
      {p?.booster != null ? (
        <img
          className="tile-img booster side-booster"
          data-testid={`side-booster-${seat}`}
          src={boosterImage(p.booster)}
          alt={boosterName(p.booster)}
          title={boosterName(p.booster)}
        />
      ) : null}
    </div>
  );
}

export function ExplorationBoard({ state, seat }: ExplorationBoardProps): ReactElement | null {
  if (state.config.lostFleet !== true) return null;
  const p = state.players[seat];
  if (p === undefined) return null;
  const cost = p.faction === 'baltaks' ? 7 : 5;
  const twoPlayer = state.config.playerCount === 2;
  const totalShuttles = twoPlayer ? 2 : 3;
  const deployed = p.shuttles.length;
  return (
    <section
      className="exploration-board"
      data-testid={`exploration-board-${seat}`}
      data-cost={cost}
      title={`${factionName(p.faction)}飞船面板（派遣 ${cost} VP）\n${FACTION_ADJUST[p.faction]}`}
    >
      <img className="eb-panel-img" src={factionPanelImage(p.faction)} alt={`${factionName(p.faction)}飞船面板`} />
      {Array.from({ length: totalShuttles }, (_, i) => {
        const used = i < deployed;
        const shuttle = used ? p.shuttles[i] : undefined;
        // 顶槽印「3-4」仅 3-4 人局启用；2 人局用下方 2 槽
        const slot = PANEL_SHUTTLE_SLOTS[i + (twoPlayer ? PANEL_SLOT_OFFSET_2P : 0)]!;
        return (
          <span
            key={i}
            className={`eb-shuttle${used ? ' used' : ''}`}
            data-testid={`eb-shuttle-${seat}-${i}`}
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${PANEL_SHUTTLE_W * 100}%`,
            }}
            title={shuttle !== undefined ? `已派往 ${shipName(shuttle.ship)}` : '未派遣'}
          >
            {used ? null : <img src={SHUTTLE_IMAGE} alt="穿梭机" />}
          </span>
        );
      })}
    </section>
  );
}
