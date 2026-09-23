/**
 * 决策探针：打印指定座位 R1-R3 每个主行动决策的 Top 候选及组 pv 分解，
 * 看清 AI 为什么选散点而不是聚拢。
 *
 *   npx vite-node packages/llm/bench/probe.ts [seed] [seat]
 */
import {
  applyAction,
  buildingPowerValue,
  enumerateActions,
  hexesWithin,
  newGame,
  settleSetupSkips,
  type Action,
  type GameState,
  type HexKey,
  type PlayerIndex,
} from '@gaia/engine';
import { createAgent } from '../src/agents/registry.js';
import type { DecidingAgent } from '../src/decision.js';
import { evalCtx } from '../src/heuristic2/context.js';
import { scoredActions } from '../src/heuristic2/lookahead.js';

function actingPlayer(state: GameState): PlayerIndex {
  const pending = state.pending;
  if (pending !== null) {
    return pending.kind === 'charge' ? pending.queue[0]!.player : pending.player;
  }
  if (state.turnHold !== null) return state.turnHold;
  if (state.phase === 'setup') return state.setupQueue[0]!;
  return state.currentPlayerIdx;
}

function groupPv(state: GameState, seat: PlayerIndex, hex: HexKey, extra: number): number {
  let pv = extra;
  for (const h of hexesWithin(state.map, hex, 2)) {
    pv += buildingPowerValue(state, seat, state.map[h]!);
  }
  return pv;
}

async function main(): Promise<void> {
  const seed = Number(process.argv[2] ?? 8);
  const target = Number(process.argv[3] ?? 3) as PlayerIndex;
  let state = newGame({
    playerCount: 4,
    seed,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet: true,
  });
  const agents: DecidingAgent[] = [0, 1, 2, 3].map((seat) =>
    createAgent('builtin:heuristic2', { seat: seat as PlayerIndex }),
  );
  for (let steps = 0; steps < 20000; steps++) {
    if (state.phase === 'game-over') break;
    if (state.round > 6) break;
    const actor = actingPlayer(state);
    const legal = enumerateActions(state, actor);
    if (legal.length === 0) {
      const settled = settleSetupSkips(state);
      if (settled === state) break;
      state = settled;
      continue;
    }
    if (actor === target) {
      const ctx = evalCtx(state, actor);
      const scored = scoredActions(ctx, legal).slice(0, 5);
      const main = scored.filter(
        (s) => !['free-conversion', 'burn', 'charge', 'decline-charge'].includes(s.action.type),
      );
      console.log(`\n[R${state.round}] P${actor} 资源 ${JSON.stringify(ctx.me.resources)} 魔力 ${ctx.me.power.bowl1}/${ctx.me.power.bowl2}/${ctx.me.power.bowl3}`);
      for (const s of main.slice(0, 4)) {
        const a = s.action as Action & { hex?: HexKey };
        const gpv = a.hex !== undefined ? ` 组pv=${groupPv(state, actor, a.hex, 1)}` : '';
        console.log(`  ${s.action.type}${a.hex !== undefined ? `@${a.hex}` : ''}${gpv} 分=${s.score.toFixed(1)}`);
      }
      // 联邦候选单独打印（看被什么压过）。
      const feds = scored.filter((x) => x.action.type === 'form-federation');
      for (const f of feds.slice(0, 3)) {
        const a = f.action as { hexes?: unknown[]; satellites?: unknown[]; token?: string };
        console.log(`  [联邦候选] ${a.token} 组=${a.hexes?.length}hex 卫星=${a.satellites?.length} 分=${f.score.toFixed(1)}`);
      }
      // 高级片候选单独打印（看被什么压过）。
      const advs = scoredActions(ctx, legal).filter(
        (s) => (s.action as { advTechTile?: unknown }).advTechTile !== undefined,
      );
      for (const s of advs.slice(0, 3)) {
        const a = s.action as { advTechTile?: string; type: string };
        console.log(`  [高级片候选] ${a.type} ${a.advTechTile} 分=${s.score.toFixed(1)}`);
      }
    }
    const d = await agents[actor]!.decide(state, actor, legal);
    if (actor === target) {
      const a = d.action as Action & { advTechTile?: string; techTile?: string | null; research?: string | null };
      const extra =
        a.advTechTile !== undefined ? ` 高级片=${a.advTechTile}` :
        a.techTile !== undefined && a.techTile !== null ? ` 标准片=${a.techTile}` : '';
      console.log(`  → 选择: ${d.action.type}${extra}${a.research != null ? ` 升轨=${a.research}` : ''}`);
    }
    state = applyAction(state, d.action);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
