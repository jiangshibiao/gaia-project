/**
 * 探索板（Lost Fleet 各族专属飞船面板，占位自绘版）：
 * 素材不足期间用种族色块自绘——左侧族肖像 + 族名 + 派遣穿梭机费用
 * （5 VP，Bal T'aks 7 VP）+ 种族增强/削弱调整文本（按规则书 p16 与族能力），
 * 下方 3 个穿梭机位（2 人局 2 个；已派上船的显示船名，未派的空位）。
 * 仅 lostFleet 启用时渲染。
 */
import type { CSSProperties, ReactElement } from 'react';
import { FACTIONS } from '@gaia/engine';
import type { FactionId, PlayerIndex } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import { SHUTTLE_IMAGE, factionImage } from '../assets';
import { factionName, shipName } from './display';

/** 各族探索板调整文本（增强/削弱，按规则书 p16 与族能力）。 */
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

export function ExplorationBoard({ state, seat }: ExplorationBoardProps): ReactElement | null {
  if (state.config.lostFleet !== true) return null;
  const p = state.players[seat];
  if (p === undefined) return null;
  const faction = FACTIONS[p.faction];
  const cost = p.faction === 'baltaks' ? 7 : 5;
  const totalShuttles = state.config.playerCount === 2 ? 2 : 3;
  const deployed = p.shuttles.length;
  const color = faction.color;
  const borderStyle: CSSProperties = { borderColor: color };
  return (
    <section className="exploration-board" data-testid={`exploration-board-${seat}`} style={borderStyle}>
      <div className="eb-head">
        <img className="eb-portrait" src={factionImage(p.faction)} alt={factionName(p.faction)} style={{ borderColor: color }} />
        <div className="eb-head-text">
          <span className="eb-title" style={{ color }}>
            {factionName(p.faction)}
          </span>
          <span className="eb-cost">派遣穿梭机：{cost} VP</span>
        </div>
      </div>
      <p className="eb-adjust">{FACTION_ADJUST[p.faction]}</p>
      <div className="eb-shuttles">
        {Array.from({ length: totalShuttles }, (_, i) => {
          const used = i < deployed;
          const shuttle = used ? p.shuttles[i] : undefined;
          return (
            <span
              key={i}
              className={`eb-shuttle${used ? ' used' : ''}`}
              data-testid={`eb-shuttle-${seat}-${i}`}
              title={shuttle !== undefined ? `已派往 ${shipName(shuttle.ship)}` : '未派遣'}
            >
              <img src={SHUTTLE_IMAGE} alt="穿梭机" style={used ? undefined : { opacity: 0.35 }} />
              {shuttle !== undefined ? <span className="eb-shuttle-ship">{shipName(shuttle.ship)}</span> : null}
            </span>
          );
        })}
      </div>
    </section>
  );
}
