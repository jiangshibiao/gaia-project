/**
 * draft（种族选取）阶段视图（friendly / auction）。
 * - 种族网格：factions/*.jpg 小图 + 中文名；已被持有的显示持有者座位色边框 + 昵称
 *   （auction 附当前出价）；
 * - 当前行动者高亮提示"轮到你了"；friendly 点击空闲族即锁定（自动下一位）；
 * - auction：点击空闲族出价 0 持有；点击已被持有族弹出加价输入（显示当前价，
 *   须 > 当前价且 ≤ 当前价+9）；
 * - 全员就绪后显示"开始游戏"按钮（draft_confirm；与 start_game 一致任意真人可点）。
 */
import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { FACTIONS } from '@gaia/engine';
import type { FactionId, PlayerIndex } from '@gaia/engine';
import type { DraftState, RoomState } from '@gaia/protocol';
import { factionBoardImage, factionImage, factionPanelImage } from '../assets';
import { factionName } from '../game/display';
import { BoardSvg } from '../board/BoardSvg';
import { ScoreboardBoard } from '../game/ScoreboardBoard';
import type { GameStore } from '../game/store';
import { useGameStore } from '../game/store';

/** Lost Fleet 4 个新种族（基础 14 族池 = 全集 − 这 4 个，与 server draft.ts 同源）。 */
const LF_FACTION_IDS: ReadonlySet<string> = new Set<FactionId>([
  'tinkeroids',
  'darkanians',
  'moweyds',
  'space-giants',
]);

const ALL_FACTION_IDS = Object.keys(FACTIONS) as FactionId[];

/** 座位标识色（draft 阶段尚无游戏内种族色，按座位固定配色）。 */
const SEAT_COLORS = ['#3d7bd6', '#e0b92e', '#cf4444', '#3fae5a'];

function seatColor(seat: PlayerIndex): string {
  return SEAT_COLORS[seat % SEAT_COLORS.length]!;
}

/** draft 可选种族全集（展示顺序 = 引擎数据表顺序）。 */
function draftPool(lostFleet: boolean): FactionId[] {
  return lostFleet ? ALL_FACTION_IDS : ALL_FACTION_IDS.filter((f) => !LF_FACTION_IDS.has(f));
}

function seatNickname(room: RoomState, seat: PlayerIndex): string {
  return room.seats[seat]?.nickname ?? `座位 ${seat}`;
}

export function DraftView({ store, room, draft }: { store: GameStore; room: RoomState; draft: DraftState }): ReactElement {
  const s = useGameStore(store);
  const mySeat = s.seat;
  const isMyTurn = !draft.finished && draft.currentActor === mySeat;
  const isAuction = draft.mode === 'auction';
  const lostFleet = room.config.lostFleet !== false;
  const pool = draftPool(lostFleet);
  const [bidTarget, setBidTarget] = useState<FactionId | null>(null);
  const [bidText, setBidText] = useState('');
  /** 悬浮预览的种族（展示族板大图；moweyds 无高清图时回退头像小图）。 */
  const [hoverFaction, setHoverFaction] = useState<FactionId | null>(null);

  /** 座位 → 持有信息（picks 的 Record 键在 JSON 里是字符串）。 */
  const pickOf = (seat: PlayerIndex) => draft.picks[seat] ?? null;
  const holderOf = (faction: FactionId): PlayerIndex | null => {
    for (const seat of draft.turnOrder) {
      if (pickOf(seat)?.faction === faction) return seat;
    }
    return null;
  };

  const onFactionClick = (faction: FactionId): void => {
    if (!isMyTurn) return;
    const holder = holderOf(faction);
    if (holder === null) {
      // 空闲族：friendly 锁定 / auction 出价 0 持有
      store.draftPick(faction);
      setBidTarget(null);
      return;
    }
    if (!isAuction) return; // friendly 已被锁定的族不可再选
    // auction：打开加价输入
    setBidTarget(faction);
    const current = pickOf(holder)?.bid ?? 0;
    setBidText(String(current + 1));
  };

  const onBidSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (bidTarget === null) return;
    const bid = Number(bidText);
    if (!Number.isInteger(bid) || bid < 1) return;
    store.draftBid(bidTarget, bid);
    setBidTarget(null);
  };

  const myPick = mySeat !== null ? pickOf(mySeat) : null;
  const outbid = isAuction && isMyTurn && myPick === null && draft.turnOrder.some((seat) => pickOf(seat) !== null);

  return (
    <section className="draft-panel" data-testid="draft-view">
      <header className="draft-head">
        <h2>{isAuction ? '竞技选取（竞拍）' : '友好选取'}</h2>
        {draft.finished ? (
          <p className="draft-turn-hint" data-testid="draft-turn-hint">
            全员就绪，等待确认开局
          </p>
        ) : (
          <p className={`draft-turn-hint${isMyTurn ? ' my-turn' : ''}`} data-testid="draft-turn-hint">
            {isMyTurn ? '轮到你了' : `等待 ${seatNickname(room, draft.currentActor ?? 0)} 选族…`}
          </p>
        )}
        {outbid ? (
          <p className="draft-outbid" data-testid="draft-outbid">
            你的种族被出价挤掉了，请重新选择
          </p>
        ) : null}
      </header>

      <ul className="draft-grid">
        {pool.map((faction) => {
          const holder = holderOf(faction);
          const held = holder !== null;
          const pick = held ? pickOf(holder) : null;
          const clickable = isMyTurn && (!held || isAuction);
          return (
            <li key={faction}>
              <button
                type="button"
                className={`draft-faction${held ? ' held' : ''}${clickable ? '' : ' disabled'}`}
                style={held ? { borderColor: seatColor(holder) } : undefined}
                data-testid={`draft-faction-${faction}`}
                // 不用 disabled 属性（它会吞掉 hover/focus 事件）——锁定后（friendly 全员
                // 或对手持有）鼠标悬浮/聚焦仍需能预览种族面板；点击由 onFactionClick 的
                // clickable 逻辑拦截（friendly 已持有/非我回合天然无效）。
                aria-disabled={!clickable}
                onClick={() => onFactionClick(faction)}
                onMouseEnter={() => setHoverFaction(faction)}
                onMouseLeave={() => setHoverFaction(null)}
                onFocus={() => setHoverFaction(faction)}
                onBlur={() => setHoverFaction(null)}
              >
                <img className="draft-faction-img" src={factionImage(faction)} alt={factionName(faction)} />
                <span className="draft-faction-name">{factionName(faction)}</span>
                {held && pick !== null ? (
                  <span className="draft-faction-holder" style={{ color: seatColor(holder) }} data-testid={`draft-holder-${faction}`}>
                    {seatNickname(room, holder)}
                    {isAuction ? ` · 出价 ${pick.bid}` : ''}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {/* 规则书 setup 信息公开（选族期间可见）：顺位（先手洗牌）/ 回合计分 / 终局计分 / 地图 */}
      {draft.preview !== undefined ? (
        <div className="draft-info" data-testid="draft-info">
          <div className="draft-info-row" data-testid="draft-turn-order">
            <span className="draft-info-label">顺位</span>
            {draft.turnOrder.map((seat, i) => (
              <span key={seat} className="draft-order-chip" style={{ borderColor: seatColor(seat), color: seatColor(seat) }}>
                {i + 1}. {seatNickname(room, seat)}
                {i === 0 ? '（先手）' : ''}
              </span>
            ))}
          </div>
          <div className="draft-info-row" data-testid="draft-scoring">
            {/* 整块实图计分板（与对局右栏同款）：回合计分片入槽 + 终局片 + 星球转化关系 */}
            <ScoreboardBoard
              state={draft.preview}
              nicknames={room.seats.map((info) => info?.nickname)}
              seat={mySeat ?? 0}
            />
          </div>
          <div className="draft-info-map" data-testid="draft-map">
            <BoardSvg state={draft.preview} />
          </div>
        </div>
      ) : null}

      {/* 悬浮种族面板预览（右侧固定，pointer-events none 不挡选族操作；
          LF 局右侧并放该族飞船板块图，便于查看增强/削弱） */}
      {hoverFaction !== null ? (
        <div className="draft-hover-pop" data-testid="draft-hover-pop">
          <div className="draft-hover-imgs">
            <img
              className="draft-hover-board"
              src={factionBoardImage(hoverFaction) ?? factionImage(hoverFaction)}
              alt={`${factionName(hoverFaction)}族板`}
            />
            {lostFleet ? (
              <img
                className="draft-hover-panel"
                src={factionPanelImage(hoverFaction)}
                alt={`${factionName(hoverFaction)}飞船板块`}
              />
            ) : null}
          </div>
          <span>{factionName(hoverFaction)}</span>
        </div>
      ) : null}

      {bidTarget !== null ? (
        <form className="draft-bid-form" data-testid="draft-bid-form" onSubmit={onBidSubmit}>
          {(() => {
            const holder = holderOf(bidTarget);
            const current = holder !== null ? (pickOf(holder)?.bid ?? 0) : 0;
            return (
              <>
                <span>
                  对 {factionName(bidTarget)} 加价（当前价 {current}，可出 {current + 1}–{current + 9}）
                </span>
                <input
                  data-testid="draft-bid-input"
                  value={bidText}
                  inputMode="numeric"
                  onChange={(e) => setBidText(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <button type="submit" className="btn-primary" data-testid="draft-bid-submit">
                  出价
                </button>
                <button type="button" className="btn-ghost" onClick={() => setBidTarget(null)}>
                  取消
                </button>
              </>
            );
          })()}
        </form>
      ) : null}

      {draft.finished && mySeat !== null ? (
        <div className="draft-summary">
          <ul className="draft-picks">
            {draft.turnOrder.map((seat) => {
              const pick = pickOf(seat);
              return (
                <li key={seat} data-testid={`draft-pick-${seat}`}>
                  <span style={{ color: seatColor(seat) }}>{seatNickname(room, seat)}</span>
                  {'：'}
                  {pick !== null ? factionName(pick.faction) : '—'}
                  {isAuction && pick !== null ? `（起始 VP ${10 - pick.bid}）` : ''}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="btn-primary btn-start"
            data-testid="draft-confirm"
            disabled={s.connection !== 'connected'}
            onClick={() => store.draftConfirm()}
          >
            开始游戏
          </button>
        </div>
      ) : null}
    </section>
  );
}
