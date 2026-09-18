/**
 * 合法行动枚举：当前局面下某玩家的全部合法行动（完全指定、可直接 apply）。
 *
 * - pending 非空：只返回 pending 对应玩家的响应行动（charge / itars 盖亚换板 /
 *   terrans 盖亚兑换）；
 * - phase==='setup'：只对 setupQueue[0]===player 返回放置/选助推器行动；
 * - phase==='game-over'：返回 []；
 * - phase==='action'：主行动只在 player===currentPlayerIdx 时枚举
 *   （build-mine/start-gaia-project/upgrade/form-federation/research/
 *   power-action/qic-action/special-action/pass）；免费行动只给当前玩家枚举。
 */
import type { Action, FreeConversionId, GameState, PlayerIndex } from './types.js';
import {
  enumerateChooseBooster,
  enumeratePlaceInitialMine,
} from './actions/setup-placement.js';
import { enumerateFreeActions } from './actions/free.js';
import { enumerateBuildMine } from './actions/mine.js';
import { enumerateResearch } from './actions/research.js';
import { enumeratePass } from './actions/pass.js';
import { enumerateGaiaProject } from './actions/gaia.js';
import { enumerateUpgrade } from './actions/upgrade.js';
import { enumerateFormFederation } from './actions/federation.js';
import { enumerateBoardActions, enumerateSpecialActions } from './actions/board-actions.js';
import { enumerateExploreShip, enumerateInspectArtifact, enumerateShipActions } from './actions/ships.js';
import { enumerateChooseTinkering, enumerateFreeMine, enumerateGainTechTile } from './actions/pending.js';
import { enumerateTechTileChoices } from './actions/tech.js';
import { FREE_CONVERSIONS } from './data/prices.js';

/** terrans 盖亚阶段兑换（pending terrans-gaia 期间可用）。 */
function terransGaiaConversions(state: GameState, player: PlayerIndex): Action[] {
  const p = state.players[player]!;
  const out: Action[] = [];
  for (const def of Object.values(FREE_CONVERSIONS)) {
    if (def.gaiaPhaseOnly !== true) {
      continue;
    }
    if (p.power.gaia >= (def.cost.gaiaPower ?? 0)) {
      out.push({ type: 'free-conversion', conversion: def.id as FreeConversionId });
    }
  }
  return out;
}

export function enumerateActions(state: GameState, player: PlayerIndex): Action[] {
  // 待决决策优先：只有被点名的玩家有行动。
  const pending = state.pending;
  if (pending !== null) {
    switch (pending.kind) {
      case 'charge':
        return pending.queue[0]?.player === player
          ? [{ type: 'charge' }, { type: 'decline-charge' }]
          : [];
      case 'itars-gaia': {
        if (pending.player !== player) {
          return [];
        }
        const p = state.players[player]!;
        // 弃 4 gaia power 换 1 科技板（可重复；研究推进禁用 L5——该入口不便
        // 携带翻面/Lost Planet 负载）；随时可结束。
        const out: Action[] = [{ type: 'itars-gaia-tech', techTile: null }];
        if (p.power.gaia >= 4) {
          for (const choice of enumerateTechTileChoices(state, player, { allowLevel5: false })) {
            const a: Extract<Action, { type: 'itars-gaia-tech' }> = {
              type: 'itars-gaia-tech',
              techTile: choice.techTile ?? null,
            };
            if (choice.advTechTile !== undefined) {
              a.advTechTile = choice.advTechTile;
            }
            if (choice.coverTechTile !== undefined) {
              a.coverTechTile = choice.coverTechTile;
            }
            if (choice.flipToken !== undefined) {
              a.flipToken = choice.flipToken;
            }
            if (choice.research !== null) {
              a.research = choice.research.track;
            }
            out.push(a);
          }
        }
        return out;
      }
      case 'terrans-gaia':
        return pending.player === player
          ? [...terransGaiaConversions(state, player), { type: 'terrans-gaia-done' }]
          : [];
      case 'tinkering':
        return pending.player === player ? enumerateChooseTinkering(state, player) : [];
      case 'gain-tech-tile':
        return pending.player === player ? enumerateGainTechTile(state, player) : [];
      case 'free-mine':
        return pending.player === player ? enumerateFreeMine(state, player) : [];
    }
  }

  if (state.phase === 'setup') {
    if (state.setupQueue[0] !== player) {
      return [];
    }
    return state.setupStage === 'boosters'
      ? enumerateChooseBooster(state, player)
      : enumeratePlaceInitialMine(state, player);
  }

  if (state.phase === 'game-over') {
    return [];
  }

  // 行动阶段：只有当前玩家有行动（免费 + 主行动）。
  if (player !== state.currentPlayerIdx || state.passedPlayers.includes(player)) {
    return [];
  }
  return [
    ...enumerateFreeActions(state, player),
    ...enumerateBuildMine(state, player),
    ...enumerateGaiaProject(state, player),
    ...enumerateUpgrade(state, player),
    ...enumerateFormFederation(state, player),
    ...enumerateResearch(state, player),
    ...enumerateBoardActions(state, player),
    ...enumerateSpecialActions(state, player),
    ...enumerateExploreShip(state, player),
    ...enumerateShipActions(state, player),
    ...enumerateInspectArtifact(state, player),
    ...enumeratePass(state, player),
  ];
}
