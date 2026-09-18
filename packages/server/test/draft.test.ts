/**
 * draft 纯逻辑单测（friendly 顺序锁定 / auction BidWhileChoosing 竞价）。
 * auction 行动顺序与校验锚定 reference/gaia-project engine 的
 * auction-bid-while-choosing.spec.ts 用例（座位从 0 起编号）。
 */
import { describe, expect, it } from 'vitest';
import type { FactionId } from '@gaia/engine';
import {
  DraftError,
  applyDraftBid,
  applyDraftPick,
  createDraft,
  draftFactionPool,
  draftResult,
} from '../src/draft.js';
import type { DraftMode } from '../src/draft.js';
import type { DraftState } from '@gaia/protocol';

const POOL = draftFactionPool(true);

function makeDraft(mode: DraftMode, playerCount = 2): DraftState {
  return createDraft(mode, playerCount, true);
}

function pick(state: DraftState, seat: number, faction: FactionId): void {
  applyDraftPick(state, POOL, seat, faction);
}

function bid(state: DraftState, seat: number, faction: FactionId, amount: number): void {
  applyDraftBid(state, POOL, seat, faction, amount);
}

describe('draftFactionPool', () => {
  it('lostFleet 18 族 / 基础 14 族', () => {
    expect(draftFactionPool(true)).toHaveLength(18);
    const base = draftFactionPool(false);
    expect(base).toHaveLength(14);
    expect(base).not.toContain('tinkeroids');
  });
});

describe('friendly', () => {
  it('按座位序锁定并自动推进，全员锁定后 finished', () => {
    const d = makeDraft('friendly', 3);
    expect(d.currentActor).toBe(0);
    pick(d, 0, 'terrans');
    expect(d.currentActor).toBe(1);
    expect(d.available).not.toContain('terrans');
    pick(d, 1, 'xenos');
    expect(d.currentActor).toBe(2);
    pick(d, 2, 'itars');
    expect(d.finished).toBe(true);
    expect(d.currentActor).toBeNull();
    const result = draftResult(d);
    expect(result.factions).toEqual(['terrans', 'xenos', 'itars']);
    expect(result.startingVp).toEqual([10, 10, 10]);
  });

  it('重复选取已被锁定的族 → invalid-faction', () => {
    const d = makeDraft('friendly');
    pick(d, 0, 'terrans');
    expect(() => pick(d, 1, 'terrans')).toThrowError(DraftError);
    expect(() => pick(d, 1, 'terrans')).toThrowError(/已被座位 0 选取/);
    // 失败后状态未变：座位 1 仍可正常选
    pick(d, 1, 'xenos');
    expect(d.finished).toBe(true);
  });

  it('非当前行动者 / 未知种族被拒绝', () => {
    const d = makeDraft('friendly');
    expect(() => pick(d, 1, 'xenos')).toThrowError(/还没轮到你/);
    expect(() => pick(d, 0, 'not-a-faction' as FactionId)).toThrowError(/未知种族/);
  });

  it('friendly 不可出价；未结束不可取结果', () => {
    const d = makeDraft('friendly');
    expect(() => bid(d, 0, 'terrans', 1)).toThrowError(/仅竞价模式/);
    expect(() => draftResult(d)).toThrowError(/尚未结束/);
  });
});

describe('auction', () => {
  it('选空闲族出价 0 持有；全员有种族即结束', () => {
    const d = makeDraft('auction');
    pick(d, 0, 'geodens');
    pick(d, 1, 'itars');
    expect(d.finished).toBe(true);
    expect(draftResult(d)).toEqual({ factions: ['geodens', 'itars'], startingVp: [10, 10] });
  });

  it('抬价挤人：原持有者回到未分配并被插队，起始 VP = 10 − 出价', () => {
    // 参考引擎 2 人用例：p1 faction geodens / p2 bid 2 / p1 bid 3 / p2 bid 4 / p1 faction itars
    const d = makeDraft('auction');
    pick(d, 0, 'geodens');
    bid(d, 1, 'geodens', 2);
    expect(d.picks[0]).toBeNull(); // 座位 0 被挤回未分配
    expect(d.currentActor).toBe(0); // 环绕扫描：下一个是座位 0
    bid(d, 0, 'geodens', 3);
    bid(d, 1, 'geodens', 4);
    pick(d, 0, 'itars');
    expect(d.finished).toBe(true);
    expect(draftResult(d)).toEqual({ factions: ['itars', 'geodens'], startingVp: [10, 6] });
  });

  it('3 人互抢（锚定参考引擎用例的行动顺序）', () => {
    const d = makeDraft('auction', 3);
    pick(d, 0, 'geodens');
    pick(d, 1, 'taklons');
    bid(d, 2, 'geodens', 1);
    expect(d.currentActor).toBe(0); // 从座位 2 下一位环绕：0 未持有
    bid(d, 0, 'geodens', 2);
    expect(d.currentActor).toBe(2);
    bid(d, 2, 'taklons', 1);
    expect(d.currentActor).toBe(1);
    bid(d, 1, 'geodens', 3);
    bid(d, 0, 'geodens', 4);
    bid(d, 1, 'geodens', 5);
    bid(d, 0, 'taklons', 2);
    bid(d, 2, 'geodens', 6);
    pick(d, 1, 'itars');
    expect(d.finished).toBe(true);
    expect(draftResult(d)).toEqual({
      factions: ['taklons', 'itars', 'geodens'],
      startingVp: [8, 10, 4],
    });
  });

  it('4 人行动顺序（锚定参考引擎用例：从行动者下一位起找第一个未持有者）', () => {
    const d = makeDraft('auction', 4);
    pick(d, 0, 'itars');
    pick(d, 1, 'taklons');
    bid(d, 2, 'itars', 2);
    // 座位 0 被挤，但下一行动者是座位 3（从行动者 2 的下一位起），与参考引擎一致
    expect(d.currentActor).toBe(3);
    pick(d, 3, 'terrans');
    expect(d.currentActor).toBe(0);
    bid(d, 0, 'taklons', 1);
    expect(d.currentActor).toBe(1);
    bid(d, 1, 'terrans', 1);
    expect(d.currentActor).toBe(3);
    bid(d, 3, 'taklons', 2);
    expect(d.currentActor).toBe(0);
    pick(d, 0, 'geodens');
    expect(d.finished).toBe(true);
    expect(draftResult(d)).toEqual({
      factions: ['geodens', 'terrans', 'itars', 'taklons'],
      startingVp: [10, 9, 8, 8],
    });
  });

  it('bid 校验：须 > 当前价且 ≤ 当前价+9 的整数', () => {
    const d = makeDraft('auction');
    pick(d, 0, 'itars');
    expect(() => bid(d, 1, 'itars', 0)).toThrowError(/出价须为 1\.\.9/);
    expect(() => bid(d, 1, 'itars', 10)).toThrowError(/出价须为 1\.\.9/);
    expect(() => bid(d, 1, 'itars', 1.5)).toThrowError(DraftError);
    bid(d, 1, 'itars', 1);
    expect(() => bid(d, 0, 'itars', 1)).toThrowError(/当前价 1/);
    expect(() => bid(d, 0, 'itars', 11)).toThrowError(DraftError);
  });

  it('对无人持有的族不可 bid（应直接 pick）；已结束的 draft 不可再行动', () => {
    const d = makeDraft('auction');
    expect(() => bid(d, 0, 'terrans', 1)).toThrowError(/无人持有/);
    pick(d, 0, 'terrans');
    pick(d, 1, 'xenos');
    expect(() => pick(d, 0, 'itars')).toThrowError(/已结束/);
  });

  it('对已被持有的族 pick → 提示用 draft_bid', () => {
    const d = makeDraft('auction');
    pick(d, 0, 'terrans');
    expect(() => pick(d, 1, 'terrans')).toThrowError(/draft_bid/);
  });
});
