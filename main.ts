// Token Radar, round 6: read the sealed DefiLlama snapshot, rank the
// pre-token protocols by implied value, and write the board, the dashboard's
// data, the dashboard itself, the screenshots and the dossier.
//
//   node main.ts --input <snapshot.json|directory>
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// Without --input the snapshot is read from /input/snapshot.json; without
// MAKEFUN_OUTPUT_DIR the outputs go to /output. Everything is deterministic:
// the same snapshot always writes the same bytes, so the grader's two runs
// agree. Node's standard library only, no network, no clock — ages come
// from the snapshot's own as_of date.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The guards the entry holds itself to: the dashboard's source stays small
// enough for the dossier's text to carry whole, and the dossier stays
// comfortably inside its cap.
const DASHBOARD_SOURCE_MAX = 60000;
const DOSSIER_MAX = 1470000;
const TEXT_MAX = 65536;

function die(message: string): never {
  console.error(`token radar: ${message}`);
  process.exit(1);
}

// The snapshot path: --input names a file or a directory holding
// snapshot.json; without it, the sealed /input mount.
function snapshotPath(argv: string[]): string {
  const at = argv.indexOf('--input');
  if (at < 0) return '/input/snapshot.json';
  const given = argv[at + 1];
  if (!given) die('--input needs a path: a snapshot.json file or the directory holding one');
  if (existsSync(given) && statSync(given).isDirectory()) return join(given, 'snapshot.json');
  return given;
}

function readSnapshot(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    die(`no snapshot at ${path}: pass --input <snapshot.json|directory> or mount the sealed /input`);
  }
}

// Plain files under a directory, relative paths, in sorted order.
function listFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(rel === '' ? root : join(root, rel), { withFileTypes: true })) {
      const p = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) found.push(p);
    }
  };
  walk('');
  return found.sort();
}

function money(usd: number): string {
  return `$${Math.round(usd).toLocaleString('en-US')}`;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = process.env['MAKEFUN_OUTPUT_DIR'] || '/output';
  // Never write into the repository itself: the output step clears the
  // dashboard/ and screenshots/ it is about to copy, so an output dir of
  // the repo root would eat the sources.
  if (outDir === here) die('refusing to write outputs into the repository directory itself');
  const snapshot = parseSnapshot(readSnapshot(snapshotPath(process.argv.slice(2))));
  const { board, radar } = buildRadar(snapshot);

  const issue = boardIssue(board, snapshot);
  if (issue) die(`the board fails its own gate: ${issue}`);

  // Dashboard source: every file under dashboard/, counted before copying.
  const dashRoot = join(here, 'dashboard');
  const dashFiles = listFiles(dashRoot);
  const dashBytes = dashFiles.reduce((sum, f) => sum + statSync(join(dashRoot, f)).size, 0);
  if (dashBytes > DASHBOARD_SOURCE_MAX) {
    die(`dashboard source is ${dashBytes} bytes, over the ${DASHBOARD_SOURCE_MAX} the dossier's text carries whole`);
  }
  const shotRoot = join(here, 'screenshots');
  const shotFiles = listFiles(shotRoot);
  if (shotFiles.length < 3 || shotFiles.length > 4) {
    die(`screenshots/ holds ${shotFiles.length} images, not 3 or 4`);
  }

  // Fresh outputs: clear only the paths this program owns, then write.
  mkdirSync(outDir, { recursive: true });
  for (const name of ['board.json', 'data.js', 'dashboard', 'screenshots', 'dossier.json']) {
    rmSync(join(outDir, name), { recursive: true, force: true });
  }
  writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));
  cpSync(dashRoot, join(outDir, 'dashboard'), { recursive: true });
  cpSync(shotRoot, join(outDir, 'screenshots'), { recursive: true });

  const dossier = buildDossier(outDir, { text_max_bytes: TEXT_MAX });
  if (dossier.length > DOSSIER_MAX) {
    die(`dossier is ${dossier.length} bytes, over the ${DOSSIER_MAX} cap`);
  }
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const ablation = (term: string) => radar.ablation.find((a) => a.term === term);
  const chains = ablation('Curve + chain count only');
  const logAge = ablation('Curve + log-age only');
  console.log(`token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the kit watchlist, ${board.length} rows ranked`);
  console.log(
    `token radar: curve 10^${radar.curve.a} x TVL^${radar.curve.b} on ${radar.comps_n} comps; held-out miss x${radar.tests.loo.miss} (LOO) / x${radar.tests.time.miss} (older->newer); implied total ${money(radar.total_implied)}`,
  );
  console.log(
    `token radar: chain count ADOPTED — slope ${radar.chains.slope} on log10(chain count), centred at ${radar.chains.mean}; single-term x${chains?.loo} (LOO) / x${chains?.time} (older->newer), ${chains?.verdict}; log-age x${logAge?.loo} / x${logAge?.time}, ${logAge?.verdict}; odds Brier ${radar.tests.brier.model} shrunk / ${radar.tests.brier.unshrunk} raw / ${radar.tests.brier.base} base`,
  );
  console.log(
    `token radar: floor ledger — ${radar.floor.at_floor} no-token protocols at or above $${(radar.floor.floor_usd / 1000000).toFixed(0)}M: ${radar.floor.ranked} ranked on the watchlist, ${radar.floor.excluded} set aside by rule`,
  );
  console.log(
    `token radar: wrote ${outDir}/board.json, ${outDir}/data.js, ${outDir}/dashboard (${dashFiles.length} files, ${dashBytes} source bytes), ${outDir}/screenshots (${shotFiles.length} images) and ${outDir}/dossier.json`,
  );
}

try {
  main();
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
