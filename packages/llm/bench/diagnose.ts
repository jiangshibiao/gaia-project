/**
 * 诊断工具：打一局 v2 内战，打印每座位终局面貌 + 行动类型直方图 +
 * 联邦/高级片的"枚举机会 vs 实际选择"统计，定位"分低在哪"。
 *
 *   npx vite-node packages/llm/bench/diagnose.ts [seed] [--no-lf]
 */
import {
  applyAction,
  buildingPowerValue,
  countUnits,
  enumerateActions,
  FEDERATION_TOKENS,
  FINAL_RANK_VP,
  FINAL_SCORING,
  finalCount,
  hexKey,
  hexNeighbors,
  newGame,
  parseHexKey,
  settleSetupSkips,
  type Action,
  type GameState,
  type HexKey,
  type PlayerIndex,
} from '@gaia/engine';
import { createAgent } from '../src/agents/registry.js';
import type { DecidingAgent } from '../src/decision.js';

function actingPlayer(state: GameState): PlayerIndex {
  const pending = state.pending;
  if (pending !== null) {
    return pending.kind === 'charge' ? pending.queue[0]!.player : pending.player;
  }
  if (state.phase === 'setup') return state.setupQueue[0]!;
  return state.currentPlayerIdx;
}

function seatReport(state: GameState, seat: PlayerIndex): string {
  const p = state.players[seat]!;
  const buildings =
    `M${8 - p.buildings.mine} TS${4 - p.buildings.ts} Lab${3 - p.buildings.lab}` +
    ` PI${p.buildings.pi === 0 ? 1 : 0} AC${(p.buildings.ac1 === 0 ? 1 : 0) + (p.buildings.ac2 === 0 ? 1 : 0)}`;
  const research = Object.entries(p.research)
    .map(([t, l]) => `${t}=${l}`)
    .join(' ');
  const r = p.resources;
  return (
    `P${seat} ${p.faction} VP=${p.vp}\n` +
    `  建筑: ${buildings} | 联邦: ${p.federationTokens.map((t) => `${t.id}${t.flipped ? '(翻)' : ''}`).join(',') || '无'} ` +
    `| 星球类型 ${countUnits(state, seat, 'planet-type')} 扇区 ${countUnits(state, seat, 'sector')} ` +
    `盖亚星 ${countUnits(state, seat, 'gaia-planet')} 卫星 ${p.satellites}\n` +
    `  研究: ${research}\n` +
    `  科技片: ${p.techTiles.join(',') || '无'} 高级片: ${p.advTechTiles.map((t) => t.id).join(',') || '无'}\n` +
    `  资源: ${r.ore}o ${r.credits}c ${r.knowledge}k ${r.qic}q | 魔力 ${p.power.bowl1}/${p.power.bowl2}/${p.power.bowl3} gaia=${p.power.gaia}`
  );
}

/** 终局每座位最大纯邻接联邦组 pv（不含卫星桥）与总 pv。 */
function fedGroupProbe(state: GameState, seat: PlayerIndex): string {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const own: HexKey[] = [];
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.building?.player === seat || hex.additionalMine === seat) own.push(key as HexKey);
  }
  for (const k of own) parent.set(k, k);
  for (const k of own) {
    for (const nb of hexNeighbors(parseHexKey(k))) {
      const nbKey = hexKey(nb);
      if (parent.has(nbKey)) parent.set(find(k), find(nbKey));
    }
  }
  const groups = new Map<string, number>();
  let total = 0;
  for (const k of own) {
    const hex = state.map[k]!;
    const pv =
      hex.additionalMine === seat && hex.building?.player !== seat
        ? 1
        : buildingPowerValue(state, seat, hex);
    total += pv;
    const r = find(k);
    groups.set(r, (groups.get(r) ?? 0) + pv);
  }
  const max = Math.max(0, ...groups.values());
  return `总pv=${total} 最大邻接组pv=${max} 组数=${groups.size}`;
}

/** VP 构成粗拆（对照人类基准：Feds21/轨道24/高级片16/回合40/booster15/终局18）。 */
function vpBreakdown(state: GameState, seat: PlayerIndex): string {
  const p = state.players[seat]!;
  const trackMs = Object.values(p.research).filter((l) => l >= 3).length * 4;
  let fedVp = 0;
  for (const t of p.federationTokens) fedVp += FEDERATION_TOKENS[t.id].vp;
  let finalVp = 0;
  for (const tileId of state.board.finalScoring) {
    const def = FINAL_SCORING[tileId];
    if (def === undefined) continue;
    const counts = state.players.map((_, i) => finalCount(state, i, def.condition));
    const mine = counts[seat]!;
    if (mine === 0) continue;
    const better = counts.filter((c) => c > mine).length;
    const ties = counts.filter((c) => c === mine).length;
    const slice = FINAL_RANK_VP.slice(better, better + ties);
    finalVp += Math.floor(slice.reduce((s, v) => s + v, 0) / Math.max(1, slice.length));
  }
  const resourceVp = Math.floor((p.resources.ore + p.resources.credits + p.resources.knowledge) / 3);
  const trickle = p.vp - trackMs - fedVp - finalVp - resourceVp;
  return (
    `VP构成: 局内(回合板/行动/QIC等)=${trickle} 联邦标记=${fedVp} 轨道里程碑=${trackMs} ` +
    `终局板=${finalVp} 资源折算=${resourceVp} | 合计=${p.vp}`
  );
}

async function main(): Promise<void> {
  const seed = Number(process.argv[2] ?? 1);
  const lostFleet = !process.argv.includes('--no-lf');
  let state = newGame({
    playerCount: 4,
    seed,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet,
  });
  const agents: DecidingAgent[] = [0, 1, 2, 3].map((seat) =>
    createAgent('builtin:heuristic2', { seat: seat as PlayerIndex }),
  );
  // 统计：每座位行动类型计数；联邦/高级片的枚举机会 vs 选择。
  const hist: Record<string, number>[] = [{}, {}, {}, {}];
  const fedChance = [0, 0, 0, 0];
  const fedTaken = [0, 0, 0, 0];
  const advChance = [0, 0, 0, 0];
  const advTaken = [0, 0, 0, 0];
  const gaiaChance = [0, 0, 0, 0];
  const gaiaTaken = [0, 0, 0, 0];
  let steps = 0;
  let lastRound = 0;
  for (; steps < 20000; steps++) {
    if (state.phase === 'game-over') break;
    if (state.round !== lastRound) {
      lastRound = state.round;
      const pw = state.players
        .map((p) => `b${p.power.bowl1 + p.power.bowl2 + p.power.bowl3}${p.power.gaia > 0 ? `+g${p.power.gaia}` : ''}`)
        .join(' ');
      console.log(`[R${state.round}] 魔力总存量: ${pw}`);
    }
    const actor = actingPlayer(state);
    const legal = enumerateActions(state, actor);
    if (legal.length === 0) {
      const settled = settleSetupSkips(state);
      if (settled === state) break;
      state = settled;
      continue;
    }
    if (legal.some((a: Action) => a.type === 'form-federation')) fedChance[actor]!++;
    if (legal.some((a: Action) => (a.type === 'gain-tech-tile' || a.type === 'upgrade') && (a as { advTechTile?: unknown }).advTechTile !== undefined)) advChance[actor]!++;
    if (legal.some((a: Action) => a.type === 'start-gaia-project')) gaiaChance[actor]!++;
    const d = await agents[actor]!.decide(state, actor, legal);
    const t = d.action.type;
    hist[actor]![t] = (hist[actor]![t] ?? 0) + 1;
    if (t === 'form-federation') fedTaken[actor]!++;
    if (t === 'gain-tech-tile' && (d.action as { advTechTile?: unknown }).advTechTile !== undefined) advTaken[actor]!++;
    if (t === 'start-gaia-project') gaiaTaken[actor]!++;
    state = applyAction(state, d.action);
  }
  console.log(`seed=${seed} lostFleet=${lostFleet} 步数=${steps}`);
  for (let seat = 0; seat < 4; seat++) {
    console.log(seatReport(state, seat));
    const top = Object.entries(hist[seat]!)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}×${n}`)
      .join(' ');
    console.log(`  行动: ${top}`);
    console.log(
      `  机会vs选择: 联邦 ${fedChance[seat]}/${fedTaken[seat]} 高级片 ${advChance[seat]}/${advTaken[seat]} 盖亚计划 ${gaiaChance[seat]}/${gaiaTaken[seat]} | ${fedGroupProbe(state, seat)}`,
    );
    console.log(`  ${vpBreakdown(state, seat)}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
