/**
 * 行动应用框架：合法性校验（规范化后与 enumerateActions 输出 stableStringify
 * 比对）→ structuredClone → 分派到 actions/ 各模块 → setup 空枚举跳过 /
 * 第 1 轮开始结算 / 回合推进。
 */
import { IllegalActionError } from './errors.js';
import type { Action, GameState, PlayerIndex } from './types.js';
import { stableStringify } from './serialize.js';
import { advanceSetup } from './setup.js';
import { enumerateActions } from './enumerate.js';
import { applyPlaceInitialMine, applyChooseBooster } from './actions/setup-placement.js';
import { applyFreeConversion, applyBurn } from './actions/free.js';
import { applyChargeResponse } from './actions/charge.js';
import { applyBuildMine } from './actions/mine.js';
import { applyResearch } from './actions/research.js';
import { applyPass } from './actions/pass.js';
import { applyGaiaProject, applyItarsGaiaTech, applyTerransGaiaDone } from './actions/gaia.js';
import { applyUpgrade } from './actions/upgrade.js';
import { applyFormFederation } from './actions/federation.js';
import { applyBoardAction, applySpecialAction } from './actions/board-actions.js';
import { applyExploreShip, applyInspectArtifact, applyShipAction } from './actions/ships.js';
import { applyChooseTinkering, applyFreeMine, applyGainTechTile } from './actions/pending.js';
import { applyIncomeOrder } from './actions/income.js';
import { chargePower, gainPowerTokens } from './state.js';
import { activateNextIncomePending, advanceTurn, settleRoundStart } from './turn.js';

export interface ApplyOptions {
  /** 高频路径（自对弈/MCTS）跳过合法性校验。 */
  assumeLegal?: boolean;
}

/** 主行动（消耗本回合；apply 后 pending 为空时推进回合）。 */
const MAIN_ACTION_TYPES: ReadonlySet<string> = new Set([
  'build-mine',
  'start-gaia-project',
  'upgrade',
  'form-federation',
  'research',
  'power-action',
  'qic-action',
  'special-action',
  'ship-action',
  'explore-ship',
  'inspect-artifact',
  'pass',
]);

/** 响应行动：pending 清空时推进回合（主行动产生的邀约/决策已全员响应完毕）。
 * choose-tinkering 不在此列——它是轮首决策（盖亚阶段串联），不是主行动的后续。 */
const RESPONSE_ACTION_TYPES: ReadonlySet<string> = new Set([
  'charge',
  'decline-charge',
  'gain-tech-tile',
  'free-mine',
]);

/**
 * setup 空枚举跳过：当 setupQueue[0] 无合法行动（ivits/LF 新族在 mines 阶段、
 * 普通族在 extra 阶段）时自动 advanceSetup 跳过该玩家。纯函数。
 */
export function settleSetupSkips(state: GameState): GameState {
  let s = state;
  // 防御性上限：阶段单调推进，正常最多跳过 2×人数 次。
  for (let i = 0; i < 32 && s.phase === 'setup'; i++) {
    // 放置产生的充能邀约待决时不得跳过（邀约响应完毕才继续 setup）。
    if (s.pending !== null) {
      break;
    }
    const head = s.setupQueue[0];
    if (head === undefined || enumerateActions(s, head).length > 0) {
      break;
    }
    s = advanceSetup(s);
  }
  return s;
}

/**
 * 收入顺序待决的自动冲刷（tokens-first 贪心结清）：重放旧对局（行动日志无
 * income-order 记录，当时收入是自动结算的）或任何失同步场景下，非 income-order
 * 行动到来前先把遗留的收入决策自动结清。冲刷可能连带跑盖亚阶段（队列空时），
 * 产生的 terrans/itars/tinkering pending 照常留给后续行动响应。
 */
export function settleIncomeSkips(state: GameState, actionType: string): GameState {
  if (actionType === 'income-order' || state.pending?.kind !== 'income-order') {
    return state;
  }
  const out = structuredClone(state);
  while (out.pending?.kind === 'income-order') {
    const pd = out.pending;
    const p = out.players[pd.player]!;
    gainPowerTokens(p, pd.tokens);
    chargePower(p, pd.charge);
    activateNextIncomePending(out);
  }
  return out;
}

/**
 * turnHold 自动放行（旧日志重放/失同步兼容）：非持闸玩家的行动到来时视同已确认
 * 自动放闸；持闸玩家自己的免费行动/烧脑/confirm-turn 照常处理（不清闸）。
 */
export function settleTurnHoldSkips(state: GameState, action: Action): GameState {
  const holder = state.turnHold;
  if (holder === null) return state;
  const byHolder =
    action.type === 'confirm-turn' ||
    ((action.type === 'free-conversion' || action.type === 'burn') && (action.actor ?? holder) === holder);
  if (byHolder) return state;
  const out = structuredClone(state);
  out.turnHold = null;
  return out;
}

/** 行动的行为人（用于合法性校验时选择枚举视角）。 */
function actorOf(state: GameState, action: Action): PlayerIndex {
  switch (action.type) {
    case 'charge':
    case 'decline-charge':
      return state.pending?.kind === 'charge' ? (state.pending.queue[0]?.player ?? -1) : -1;
    case 'itars-gaia-tech':
      return state.pending?.kind === 'itars-gaia' ? state.pending.player : -1;
    case 'terrans-gaia-done':
      return state.pending?.kind === 'terrans-gaia' ? state.pending.player : -1;
    case 'choose-tinkering':
      return state.pending?.kind === 'tinkering' ? state.pending.player : -1;
    case 'gain-tech-tile':
      return state.pending?.kind === 'gain-tech-tile' ? state.pending.player : -1;
    case 'income-order':
      return state.pending?.kind === 'income-order' ? state.pending.player : -1;
    case 'confirm-turn':
      return state.turnHold ?? -1;
    case 'burn':
      // 显式 actor 优先（重放注入库中 player 列）；turnHold 期间缺省持闸玩家。
      return action.actor ?? state.turnHold ?? state.currentPlayerIdx;
    case 'free-mine':
      return state.pending?.kind === 'free-mine' ? state.pending.player : -1;
    case 'free-conversion':
      // terrans PI 盖亚阶段兑换：行为人是 pending 点名玩家（可能非当前回合玩家）。
      if (action.conversion.startsWith('terrans-gaia') && state.pending?.kind === 'terrans-gaia') {
        return state.pending.player;
      }
      // 显式 actor 优先（重放注入库中 player 列）；turnHold 期间缺省持闸玩家。
      return action.actor ?? state.turnHold ?? state.currentPlayerIdx;
    case 'place-initial-mine':
    case 'choose-booster':
      return state.setupQueue[0] ?? -1;
    default:
      return state.currentPlayerIdx;
  }
}

/** 分派到 actions/ 各模块（原地修改已克隆的 state）。 */
function dispatch(state: GameState, action: Action, opts?: ApplyOptions): void {
  switch (action.type) {
    case 'place-initial-mine':
      applyPlaceInitialMine(state, action.hex);
      return;
    case 'choose-booster':
      applyChooseBooster(state, action.booster);
      return;
    case 'free-conversion':
      applyFreeConversion(state, action.actor ?? actorOf(state, action), action.conversion, {
        times: action.times,
        brainstone: action.brainstone,
      });
      return;
    case 'burn':
      applyBurn(state, action.actor ?? state.turnHold ?? state.currentPlayerIdx);
      return;
    case 'charge':
      applyChargeResponse(state, true, action.amount);
      return;
    case 'decline-charge':
      applyChargeResponse(state, false);
      return;
    case 'build-mine':
      applyBuildMine(state, state.currentPlayerIdx, action.hex);
      return;
    case 'start-gaia-project':
      applyGaiaProject(state, state.currentPlayerIdx, action.hex, { powerFrom: action.powerFrom });
      return;
    case 'upgrade':
      applyUpgrade(state, state.currentPlayerIdx, action);
      return;
    case 'form-federation':
      applyFormFederation(state, state.currentPlayerIdx, action, opts?.assumeLegal === true);
      return;
    case 'research':
      applyResearch(state, state.currentPlayerIdx, action);
      return;
    case 'power-action':
    case 'qic-action':
      applyBoardAction(state, state.currentPlayerIdx, action.action, action.payload);
      return;
    case 'special-action':
      applySpecialAction(state, state.currentPlayerIdx, action.action, action.payload);
      return;
    case 'pass':
      applyPass(state, state.currentPlayerIdx, action.booster);
      return;
    case 'explore-ship':
      applyExploreShip(state, state.currentPlayerIdx, action.ship);
      return;
    case 'ship-action':
      applyShipAction(state, state.currentPlayerIdx, action.ship, action.action, action.payload);
      return;
    case 'inspect-artifact':
      applyInspectArtifact(state, state.currentPlayerIdx, action.artifact, action.federationToken);
      return;
    case 'choose-tinkering':
      applyChooseTinkering(state, action.tile);
      return;
    case 'gain-tech-tile':
      applyGainTechTile(state, action);
      return;
    case 'income-order':
      applyIncomeOrder(state, action.order);
      return;
    case 'free-mine':
      applyFreeMine(state, action.hex);
      return;
    case 'itars-gaia-tech':
      applyItarsGaiaTech(state, action);
      return;
    case 'terrans-gaia-done':
      applyTerransGaiaDone(state);
      return;
    case 'confirm-turn':
      if (state.turnHold === null) {
        throw new IllegalActionError('no-turn-hold', '当前无待确认的回合（turnHold 为空）');
      }
      state.turnHold = null;
      return;
    default:
      throw new IllegalActionError('not-implemented', `行动暂未实现: ${String((action as { type: unknown }).type)}`);
  }
}

/**
 * 应用行动：返回新状态（入参不被修改）。
 * 合法性 = 与 enumerateActions 输出 stableStringify 比对，不在集内抛
 * IllegalActionError('illegal-action')；opts.assumeLegal 跳过校验。
 */
export function applyAction(state: GameState, action: Action, opts?: ApplyOptions): GameState {
  const settled = settleTurnHoldSkips(settleIncomeSkips(settleSetupSkips(state), action.type), action);
  if (opts?.assumeLegal !== true) {
    const actor = actorOf(settled, action);
    const key = stableStringify(action);
    const legal = enumerateActions(settled, actor).some((a) => stableStringify(a) === key);
    if (!legal) {
      throw new IllegalActionError('illegal-action', `非法行动: ${key}`);
    }
  }

  const next = structuredClone(settled);
  const phaseBefore = next.phase;
  dispatch(next, action, opts);
  const out = settleSetupSkips(next);

  // setup 完成 → 第 1 轮收入 + 盖亚阶段。
  if (phaseBefore === 'setup' && out.phase === 'action') {
    settleRoundStart(out);
  }
  // 主行动 apply 后 pending 为空才推进回合；响应行动清空 pending 后同样推进。
  if (
    out.phase === 'action' &&
    out.pending === null &&
    (MAIN_ACTION_TYPES.has(action.type) || RESPONSE_ACTION_TYPES.has(action.type))
  ) {
    // 回合完成闸：非 pass 主行动（及其 pending 全部响应完毕）后置闸给行动者——
    // 确认（confirm-turn）或撤销前，下一玩家不得行动（按钮不亮）。pass 直接推进不设闸。
    if (action.type !== 'pass' && out.turnHold === null) {
      out.turnHold = out.currentPlayerIdx;
    }
    advanceTurn(out);
  }
  return out;
}
