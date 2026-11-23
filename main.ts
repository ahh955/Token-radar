// Token Radar, round 4: the program that builds the board.
//
// Round 4 is a display-only rebuild on the same radar-3 model: the board
// numbers are identical to round 3, and the dashboard gains a second
// evidence panel (the token-odds Brier ladder and the peers'-record bar
// chart), "Best farms now" cards, a break-even odds line, and a peers
// table that hides outliers more than 10x off the curve. Two candidate
// model terms (chain count, log-age) are tested held-out in the ablation
// and labelled honestly — neither is adopted in this round.
//
// Reads the sealed DefiLlama snapshot, scores every pre-token protocol with
// the fitted model in lib/model.ts, and writes the ranked board, the
// dashboard's dataset, the dashboard itself, the screenshots and the
// dossier into the output directory. Deterministic: same snapshot in, same
// bytes out. No clock, no randomness (the model's bootstrap uses a fixed
// seed), no network, Node standard library only.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// The scorer's caps, mirrored here so a bad build fails loudly at home.
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

// `--name <value>` or `--name=<value>`, else the fallback.
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// The two candidate terms the ablation tested this round (neither adopted).
const chainsRow = radar.ablation.find((a) => a.term.includes('chain count'));
const logAgeRow = radar.ablation.find((a) => a.term.includes('log-age'));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

// Copy one directory's regular files into `to`, skipping dot-names, and
// return the names copied. Refuses a name the dossier would refuse.
function copyDir(from: string, to: string, what: string): string[] {
  if (!existsSync(from)) fail(`no ${what}/ directory beside main.ts`);
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    if (!PLAIN_NAME.test(name)) fail(`${what}/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyDir(join(here, 'dashboard'), join(out, 'dashboard'), 'dashboard');
if (!dash.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dash.some((n) => n.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dash.some((n) => n.endsWith('.js'))) fail('dashboard/ holds no .js file');

// The dossier shows at most TEXT_MAX_BYTES of dashboard source; refuse a
// build whose source text would be cut, keeping headroom for the dossier's
// own headings and fences.
const sourceBytes = dash
  .filter((n) => /\.(html|css|js)$/.test(n))
  .reduce((sum, n) => sum + statSync(join(out, 'dashboard', n)).size, 0);
if (sourceBytes > 60_000) fail(`dashboard source text is ${sourceBytes} bytes, over the 60,000 the dossier shows whole`);
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'), 'screenshots');
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in at least 3, the board, a detail view and a filtered view`);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked\n` +
    `token radar: curve 10^${radar.curve.a.toFixed(4)} x TVL^${radar.curve.b.toFixed(4)} on ${radar.comps_n} comps; ` +
    `held-out miss x${radar.tests.loo.miss} (LOO) / x${radar.tests.time.miss} (older->newer); ` +
    `implied total $${radar.total_implied.toLocaleString('en-US')}\n` +
    `token radar: tested terms — chain count x${chainsRow!.loo} (LOO) / x${chainsRow!.time} (older->newer), ${chainsRow!.verdict}; ` +
    `log-age x${logAgeRow!.loo} / x${logAgeRow!.time}, ${logAgeRow!.verdict}; odds Brier ${radar.tests.brier.model} shrunk / ${radar.tests.brier.unshrunk} raw / ${radar.tests.brier.base} base\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dash.length} files, ${sourceBytes} source bytes), ` +
    `${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
