#!/usr/bin/env node
/**
 * fetch-assets — 从公开来源重建 packages/web/public/assets/ 游戏素材。
 *
 * 素材版权属原出版方，本仓库不分发素材（.gitignore 排除 packages/web/public/assets/），
 * 本脚本仅供个人非商用重建（见 assets/README.md）。
 *
 * 用法：npm run fetch-assets -w @gaia/web（幂等：已存在的产物跳过；--force 全量重来）
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'assets');
const FORCE = process.argv.includes('--force');

// ---------------------------------------------------------------------------
// 源定义
// ---------------------------------------------------------------------------
const ETCHELON = 'https://raw.githubusercontent.com/Etchelon/gaiaproject/master/Frontend/Portal/src/assets/Resources';
const VIEWER = 'https://raw.githubusercontent.com/boardgamers/gaia-project/main/viewer/src/assets';
const UIQOO = 'https://uiqoo.kr/boardgames/gaiaproject';
const FEUERLAND = 'https://www.feuerland-spiele.de/fileadmin/game/Gaia_Project/Gaia_Project_Verlorene_Flotte';

/** [src, dest] 直链下载清单。 */
const FILES = [];

// ---- Etchelon：扇区 13 + 研究板/计分板/盖亚图 ----
for (const f of ['1','2','3','4','5','6','7','8','9','10','5outlined','6outlined','7outlined']) {
  FILES.push([`${ETCHELON}/Sectors/${f}.png`, `sectors/${f}.png`]);
}
for (const f of ['ResearchBoard.jpg', 'ScoreTrack.png', 'Gaia_map.png']) {
  FILES.push([`${ETCHELON}/Boards/${f}`, `boards/${f}`]);
}
// ---- Etchelon：板块图 ----
for (const f of ['ADVfedP','ADVfedV','ADVgai','ADVknw','ADVlab','ADVminB','ADVminV','ADVore','ADVqic','ADVsecO','ADVsecV','ADVstp','ADVtrsB','ADVtrsV','ADVtyp','TECcre','TECgai','TECknw','TECore','TECpia','TECpow','TECqic','TECtyp','TECvps']) {
  FILES.push([`${ETCHELON}/Boards/TechTiles/${f}.png`, `tiles/tech/${f}.png`]);
}
for (const f of ['RNDfed','RNDgai3','RNDgai4','RNDmin','RNDpia','RNDstp','RNDter','RNDtrs3','RNDtrs4']) {
  FILES.push([`${ETCHELON}/Boards/ScoringTiles/${f}.png`, `tiles/scoring/${f}.png`]);
}
for (const f of ['FINbld','FINfed','FINgai','FINsat','FINsec','FINtyp']) {
  FILES.push([`${ETCHELON}/Boards/FinalScoring/${f}.png`, `tiles/final/${f}.png`]);
}
for (const f of ['BOOgai','BOOknw','BOOlab','BOOmin','BOOnav','BOOpia','BOOpwt','BOOqic','BOOter','BOOtrs']) {
  FILES.push([`${ETCHELON}/Boards/RoundBoosters/${f}.png`, `tiles/boosters/${f}.png`]);
}
for (const f of ['FEDcre','FEDgle','FEDknw','FEDore','FEDpwt','FEDqic','FEDvps']) {
  FILES.push([`${ETCHELON}/Boards/Federations/${f}.png`, `tiles/federations/${f}.png`]);
}
// ---- Etchelon：标记 ----
for (const f of ['Ores','Credits','Knowledge','Qic','Power','VP','Satellites','LostPlanet','SpaceStation','ActionToken','RecordToken','Federations','PlanetTypes','Sectors','Terraformation','Hand']) {
  FILES.push([`${ETCHELON}/Markers/${f}.png`, `markers/${f}.png`]);
}
// ---- Etchelon：14 族面板（高清） ----
for (const f of ['Ambas','BalTaks','Bescods','Firak','Geodens','Gleens','HadschHallas','Itars','Ivits','Lantids','Nevlas','Taklons','Terrans','Xenos']) {
  FILES.push([`${ETCHELON}/Races/Boards_original/${f}.jpg`, `factions/hi/${f}.jpg`]);
}
// ---- Etchelon：建筑棋子 42 ----
for (const t of ['MI','TS','RL','PI','AC','GF']) {
  for (const c of ['blue','brown','grey','orange','red','white','yellow']) {
    FILES.push([`${ETCHELON}/Races/Buildings_map/${t}_${c}.png`, `buildings/${t}_${c}.png`]);
  }
}
// ---- Etchelon：背景 ----
for (const f of ['background.jpg', 'hubble.jpg']) {
  FILES.push([`${ETCHELON}/${f}`, `bg/${f}`]);
}
// ---- viewer：18 族面板 ----
for (const f of ['ambas','baltaks','bescods','darkanians','firaks','geodens','gleens','hadsch-hallas','itars','ivits','lantids','mowyeds','nevlas','space-giants','taklons','terrans','tinkeroids','xenos']) {
  FILES.push([`${VIEWER}/factions/${f}.jpg`, `factions/${f}.jpg`]);
}
// ---- uiqoo：LF 全套 ----
for (const t of ['11a','11b','12a','12b','13a','13b','14a','14b','15a','15b','16a','16b','17a','17b','18a','18b']) {
  FILES.push([`${UIQOO}/map_deep_${t}.png`, `lf/deep-space/map_deep_${t}.png`]);
}
for (const t of ['eclipse','tfmars','twilight','rebellion','proto','asteroid','empty']) {
  FILES.push([`${UIQOO}/map_interspace_${t}.png`, `lf/interspace/map_interspace_${t}.png`]);
}
for (const t of ['1k1o','3c3o','3k1q','5c2o','asteroid','deep','fed','gaia','planet','proto','sci','track','pwt']) {
  FILES.push([`${UIQOO}/artifact_${t}.png`, `lf/artifacts/artifact_${t}.png`]);
}
for (const t of ['1o3k','terra','range']) {
  FILES.push([`${UIQOO}/shiptech_${t}.png`, `lf/tech-tiles/shiptech_${t}.png`]);
}
for (const t of ['asteroidpass','big','deep','deeppass','qaction','terra']) {
  FILES.push([`${UIQOO}/adv_${t}.png`, `lf/tech-tiles/adv_${t}.png`]);
}
for (const t of ['c','k','oq','range','tech','terra','pwt','vp']) {
  FILES.push([`${UIQOO}/shipfed_${t}.png`, `lf/federation-tokens/shipfed_${t}.png`]);
}
for (const t of ['c','k','o','q','pwt','vp']) {
  FILES.push([`${UIQOO}/fed_${t}.png`, `lf/federation-tokens/fed_${t}.png`]);
}
for (const t of ['deep','former','instant','planet']) {
  FILES.push([`${UIQOO}/booster_${t}.png`, `lf/boosters/booster_${t}.png`]);
}
for (const t of ['lab4','sector3','planet3']) {
  FILES.push([`${UIQOO}/round_${t}.png`, `lf/scoring/round_${t}.png`]);
}
for (const t of ['asteroid','deep','distance']) {
  FILES.push([`${UIQOO}/final_${t}.png`, `lf/scoring/final_${t}.png`]);
}
for (const t of ['Moweyds','SpaceGiants','Darkanians','Tinkeroids']) {
  FILES.push([`${UIQOO}/race_${t}.png`, `lf/factions/race_${t}.png`]);
}
for (const t of ['proto','asteroid','transdim','gaia']) {
  FILES.push([`${UIQOO}/planet_${t}.png`, `lf/planets/planet_${t}.png`]);
}
for (const t of ['pw','vp']) {
  FILES.push([`${UIQOO}/econ_${t}.png`, `lf/misc/econ_${t}.png`]);
}
for (const t of ['shuttle','vp']) {
  FILES.push([`${UIQOO}/advcond_${t}.png`, `lf/misc/advcond_${t}.png`]);
}
for (const t of ['eclipse','rebellion','tfmars','twilight']) {
  FILES.push([`${UIQOO}/shiplogo_${t}.png`, `lf/misc/shiplogo_${t}.png`]);
}
for (const t of ['powerring','shuttle','lostplanet']) {
  FILES.push([`${UIQOO}/${t}.png`, `lf/misc/${t}.png`]);
}
// ---- Feuerland：2 船板 + 2 族板 ----
FILES.push([`${FEUERLAND}/GP_Exp_FleetShips_DE_Eclipse.jpg`, `lf/ships/eclipse_board_feuerland.jpg`]);
FILES.push([`${FEUERLAND}/GP_Exp_FleetShips_Rebellion.jpg`, `lf/ships/rebellion_board_feuerland.jpg`]);
FILES.push([`${FEUERLAND}/GP_Exp_Player_Tableaus_SpaceGiants.jpg`, `factions/hi/space-giants_board_feuerland.jpg`]);
FILES.push([`${FEUERLAND}/GP_Exp_Player_Tableaus_DE_Tinkeroids.jpg`, `factions/hi/tinkeroids_board_feuerland.jpg`]);
// moweyds 族板：wellplayed 官方渲染图（青色大胡子；勿再用 BGG 粉色俯视照——那是别族）
FILES.push(['https://www.wellplayed.ch/cdn/shop/files/gaia-project-the-lost-fleet-en-capstone-games-board-499.webp?v=1733721780&width=1080', 'factions/hi/moweyds_board_wellplayed.jpg']);

/** BGG 合影裁剪：[src, dest, [x, y, w, h]]。 */
const CROPS = [
  ['https://cf.geekdo-images.com/zJdYpVoS2bXZFVlP3nYNvQ__original/img/6aVe0f8QdCK3OYMJThpjWETJnHE=/pic9503665.jpg', 'lf/ships/twilight_board_bgg9503665.png', [0, 2775, 2865, 936]],
  ['https://cf.geekdo-images.com/zJdYpVoS2bXZFVlP3nYNvQ__original/img/6aVe0f8QdCK3OYMJThpjWETJnHE=/pic9503665.jpg', 'lf/ships/tf-mars_board_bgg9503665.png', [0, 1855, 2865, 929]],
  ['https://cf.geekdo-images.com/zJdYpVoS2bXZFVlP3nYNvQ__original/img/6aVe0f8QdCK3OYMJThpjWETJnHE=/pic9503663.jpg', 'factions/hi/darkanians_board_bgg9503663.png', [0, 0, 2870, 1851]],
  ['https://cf.geekdo-images.com/2gUWH1ga3gHSMlWC1GCPlQ__large/img/TiLLakjsx6nGMPISyiCXXYHK71Q=/fit-in/1024x1024/filters:no_upscale():strip_icc()/pic8065038.jpg', 'lf/misc/tinkering-tiles_official_render.jpg', null],
];

// ---------------------------------------------------------------------------
// 处理
// ---------------------------------------------------------------------------
const log = (s) => console.log(s);
const hashFile = (buf) => createHash('sha1').update(buf).digest('hex');

async function fetchBuf(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'gaia-project-fetch-assets/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function writeDest(rel, buf) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
}

/** 简单 PNG/JPEG 内容框裁剪（去透明边距），仅用于建筑棋子。 */
async function trimImage(buf) {
  const sharp = (await import('sharp')).default;
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return buf;
  return sharp(buf)
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
}

/** 深空/Interspace 白边去透明。 */
async function stripWhite(buf) {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 0; i < info.width * info.height; i++) {
    const a = data[i * 4 + 3];
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (a > 150 && r > 190 && g > 190 && b > 190) out[i * 4 + 3] = 0;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function main() {
  let ok = 0;
  let skip = 0;
  const failures = [];
  for (const [src, rel] of FILES) {
    const dest = join(OUT, rel);
    if (!FORCE && existsSync(dest)) {
      skip++;
      continue;
    }
    try {
      let buf = await fetchBuf(src);
      if (rel.startsWith('buildings/')) buf = await trimImage(buf);
      if (rel.startsWith('lf/deep-space/') || rel.startsWith('lf/interspace/')) buf = await stripWhite(buf);
      writeDest(rel, buf);
      ok++;
    } catch (e) {
      failures.push(`${rel}: ${String(e)}`);
    }
  }
  for (const [src, rel, crop] of CROPS) {
    const dest = join(OUT, rel);
    if (!FORCE && existsSync(dest)) {
      skip++;
      continue;
    }
    try {
      let buf = await fetchBuf(src);
      if (crop) {
        const sharp = (await import('sharp')).default;
        buf = await sharp(buf).extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] }).png().toBuffer();
      }
      writeDest(rel, buf);
      ok++;
    } catch (e) {
      failures.push(`${rel}: ${String(e)}`);
    }
  }
  // 扇区全局校准值（理论值，详见 AGENTS.md「素材与校准」）
  const cal = {};
  for (const id of ['1','2','3','4','5A','5B','6A','6B','7A','7B','8','9','10']) {
    cal[id] = { rotation: 4, mirror: false, cx: 325, cy: 352.5, size: 81.25 };
  }
  writeDest('sectors/calibration.json', Buffer.from(JSON.stringify(cal, null, 2)));
  log(`done: ${ok} downloaded, ${skip} skipped, ${failures.length} failed`);
  for (const f of failures) log(`  FAIL ${f}`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
