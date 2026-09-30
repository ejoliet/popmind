/**
 * AIDEV-SPIKE: runs the numeric core sliced out of popmind-spike.html verbatim.
 * Catches NaN, degenerate clusters, non-converging layout, silhouette bugs.
 * It does NOT settle A3 — the corpus here is synthetic, so separability is
 * partly baked in. A3 is answered by running the HTML on real history.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./popmind-spike.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

const sectionAt = label => {
  const m = script.match(new RegExp(`^// ─+ *${label}.*$`, 'm'));
  if (!m) throw new Error(`section marker missing: ${label}`);
  return m.index;
};
function slice(fromLiteral, toLabel) {
  const a = script.indexOf(fromLiteral), b = sectionAt(toLabel);
  if (a < 0 || b <= a) throw new Error(`slice failed: ${fromLiteral} .. ${toLabel}`);
  return script.slice(a, b);
}

// Sections 2-4: vectorize, kNN + layout, clusters + labels. Verbatim.
const core = slice('const STOP = new Set', '5\\. render');
const sess = slice('function sessionize', '2\\. vectorize titles');

const mod = await import('data:text/javascript,' + encodeURIComponent(`
  const yieldUI = () => Promise.resolve();
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\\./,''); } catch { return '·'; } };
  ${sess}
  ${core}
  export { tokens, lexicalVectors, randomProject, knn, layout, kmeans,
           labelClusters, silhouette, sessionize, hostOf };
`));

// ────────────────────────────────────────────────── synthetic corpus
const TOPICS = {
  kubernetes: {
    hosts: ['kubernetes.io', 'stackoverflow.com', 'github.com', 'docs.aws.amazon.com'],
    head: ['Pods', 'CrashLoopBackOff', 'kubectl rollout restart', 'Managed node groups',
           'Ingress controller TLS', 'Horizontal pod autoscaler', 'EKS node group taint',
           'StatefulSet volume claim', 'RBAC service account token'],
    tail: ['Kubernetes', 'EKS', 'kubectl', 'cluster'] },
  airflow: {
    hosts: ['airflow.apache.org', 'github.com', 'stackoverflow.com', 'medium.com'],
    head: ['DAGs', 'Dynamic task mapping', 'Scheduler stuck on queued', 'Best practices',
           'Deferrable operators', 'TaskFlow API', 'Backfill catchup semantics',
           'KubernetesExecutor pod template', 'XCom serialization limits'],
    tail: ['Airflow Documentation', 'apache/airflow', 'Airflow'] },
  astronomy: {
    hosts: ['ivoa.net', 'pyvo.readthedocs.io', 'docs.astropy.org', 'irsa.ipac.caltech.edu'],
    head: ['Table Access Protocol', 'ADQL cone search', 'FITS file handling', 'ASDF format',
           'ObsCore data model', 'MOC spatial index', 'SODA cutout service',
           'VOTable serialization', 'HATS partitioned catalog'],
    tail: ['IVOA', 'astropy', 'pyvo documentation', 'IRSA'] },
  duckdb: {
    hosts: ['duckdb.org', 'parquet.apache.org', 'github.com', 'news.ycombinator.com'],
    head: ['httpfs extension', 'Querying Parquet with precision', 'Row group statistics',
           'Predicate pushdown', 'duckdb-wasm in the browser', 'Zero copy Arrow',
           'Hive partitioning', 'Column encoding dictionary', 'Iceberg table scan'],
    tail: ['DuckDB', 'Apache Parquet', 'Hacker News'] },
  fitness: {
    hosts: ['strongerbyscience.com', 'examine.com', 'pubmed.ncbi.nlm.nih.gov', 'reddit.com'],
    head: ['Hypertrophy training guide', 'Creatine dosage', 'Tendon stiffness adaptation',
           'Warmup routine before a match', 'Collagen and joint pain', 'Protein timing',
           'Eccentric loading Achilles', 'Sleep and recovery markers'],
    tail: ['Stronger By Science', 'Examine', 'PubMed', 'r/bootroom'] },
  webrtc: {
    hosts: ['peerjs.com', 'developer.mozilla.org', 'webrtc.org', 'github.com'],
    head: ['PeerJS documentation', 'RTCPeerConnection', 'TURN server setup',
           'Symmetric NAT traversal', 'DataChannel backpressure', 'ICE candidate gathering',
           'SDP munging', 'Star topology room link'],
    tail: ['MDN', 'WebRTC', 'peers/peerjs'] },
};

const rndSeed = (s => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(4242);
const pages = [];
const truth = [];
let ts = Date.UTC(2025, 8, 1);
Object.entries(TOPICS).forEach(([topic, t]) => {
  for (let r = 0; r < 8; r++)
    for (const h of t.head) {
      const host = t.hosts[(rndSeed() * t.hosts.length) | 0];
      const tail = t.tail[(rndSeed() * t.tail.length) | 0];
      const suffix = r === 0 ? '' : ` ${['', 'v2', '2026', 'part ' + r, 'revisited'][r % 5]}`;
      pages.push({
        url: `https://${host}/${topic}/${pages.length}`,
        title: `${h}${suffix} | ${tail}`,
        host, n: 1 + ((rndSeed() * 9) | 0),
        first: ts, last: ts += 6e5 + ((rndSeed() * 3e6) | 0),
      });
      truth.push(topic);
    }
});

const n = pages.length, k = Object.keys(TOPICS).length;
const ok = [], bad = [];
const check = (cond, msg) => (cond ? ok : bad).push(msg);
const line = s => console.log(s);

line('='.repeat(70));
line(`numeric core · n=${n} synthetic pages · k=${k}`);
line('='.repeat(70));

// ---- tokenizer
const tk = mod.tokens(pages[0]);
check(tk.length > 0 && !tk.includes('the') && !tk.includes('com'),
  `tokens() strips stopwords/host noise: [${tk.slice(0, 5)}]`);

// ---- lexical vectors
let t = performance.now();
const vecs = mod.lexicalVectors(pages);
const tEmbed = performance.now() - t;
let nan = 0, norms = [];
for (let i = 0; i < n; i++) {
  let m = 0;
  for (let d = 0; d < vecs.dim; d++) { const v = vecs.V[i * vecs.dim + d]; if (!Number.isFinite(v)) nan++; m += v * v; }
  norms.push(Math.sqrt(m));
}
check(nan === 0, `lexicalVectors: no NaN/Inf across ${n * vecs.dim} components`);
check(Math.min(...norms) > 0.99 && Math.max(...norms) < 1.01,
  `lexicalVectors: L2-normalized (min ${Math.min(...norms).toFixed(4)}, max ${Math.max(...norms).toFixed(4)})`);
line(`  embed ${tEmbed.toFixed(0)} ms → ${(n / tEmbed * 1000 | 0)} pages/s`);

// ---- kmeans
t = performance.now();
const lab = mod.kmeans(vecs.V, n, vecs.dim, k);
const tKm = performance.now() - t;
const sizes = Array.from({ length: k }, (_, c) => lab.reduce((a, l) => a + (l === c), 0));
check(sizes.every(s => s > 0), `kmeans: no empty field (sizes ${sizes.join('/')})`);
check(Math.max(...sizes) < n * 0.6, `kmeans: no runaway field (largest ${Math.max(...sizes)}/${n})`);

// adjusted Rand index against ground truth
function ari(a, b) {
  const A = [...new Set(a)], B = [...new Set(b)];
  const M = A.map(() => B.map(() => 0));
  a.forEach((x, i) => M[A.indexOf(x)][B.indexOf(b[i])]++);
  const c2 = x => x * (x - 1) / 2;
  const sij = M.flat().reduce((s, v) => s + c2(v), 0);
  const sa = M.reduce((s, r) => s + c2(r.reduce((x, y) => x + y, 0)), 0);
  const sb = B.map((_, j) => M.reduce((s, r) => s + r[j], 0)).reduce((s, v) => s + c2(v), 0);
  const exp = sa * sb / c2(a.length);
  return (sij - exp) / ((sa + sb) / 2 - exp);
}
const score = ari(truth, [...lab]);
line(`  kmeans ${tKm.toFixed(0)} ms · ARI vs synthetic truth = ${score.toFixed(2)}`);
check(score > 0.3, `kmeans recovers structure it should (ARI ${score.toFixed(2)} > 0.3)`);

// ---- labels
const labels = mod.labelClusters(pages, lab, k);
check(labels.every(L => L.terms.length > 0), 'labelClusters: every field named');
const named = labels.filter(L => L.terms[0] !== '(mixed)').length;
check(named >= k - 1, `labelClusters: ${named}/${k} fields got real terms`);
labels.forEach((L, c) => line(`   f${c} n=${String(L.size).padStart(3)}  ${L.terms.join(' · ')}`));

// ---- silhouette
const sil = mod.silhouette(vecs.V, n, vecs.dim, lab, k);
check(Number.isFinite(sil) && sil > -1 && sil < 1, `silhouette in range: ${sil.toFixed(3)}`);
check(sil > 0, `silhouette positive (${sil.toFixed(3)}) — clusters beat chance`);

// scrambled labels must score near zero: proves the metric is not rigged
const shuf = Int32Array.from({ length: n }, () => (rndSeed() * k) | 0);
const silRand = mod.silhouette(vecs.V, n, vecs.dim, shuf, k);
check(silRand < 0.05, `silhouette control: random labels → ${silRand.toFixed(3)} (near 0)`);

// ---- projection + kNN
t = performance.now();
const P = mod.randomProject(vecs.V, n, vecs.dim, 64);
const nb = await mod.knn(P, n, 64, 15, () => {});
const tKnn = performance.now() - t;
let selfHit = 0, negD = 0;
for (let i = 0; i < n; i++)
  for (let j = 0; j < nb.K; j++) {
    if (nb.idx[i * nb.K + j] === i) selfHit++;
    if (!Number.isFinite(nb.dist[i * nb.K + j])) negD++;
  }
check(selfHit === 0, 'knn: never returns self as neighbour');
check(negD === 0, 'knn: all similarities finite');
let sorted = true;
for (let i = 0; i < n; i++)
  for (let j = 1; j < nb.K; j++)
    if (nb.dist[i * nb.K + j] > nb.dist[i * nb.K + j - 1] + 1e-6) sorted = false;
check(sorted, 'knn: neighbours sorted by descending similarity');
// neighbour purity — the honest quality signal for the map
let pure = 0, tot = 0;
for (let i = 0; i < n; i++)
  for (let j = 0; j < nb.K; j++) { const o = nb.idx[i * nb.K + j]; if (o >= 0) { tot++; if (truth[o] === truth[i]) pure++; } }
const purity = pure / tot;
line(`  kNN ${tKnn.toFixed(0)} ms (k=15, 64-d) · neighbour purity ${(purity * 100).toFixed(1)}%`);
check(purity > 0.5, `kNN purity beats chance (${(purity * 100).toFixed(0)}% vs ${(100 / k).toFixed(0)}%)`);

// ---- layout
t = performance.now();
let lastSpread = 0;
const X = await mod.layout(nb, n, 90, (e, Xc) => {
  if (e === 89) { let mx = -1e9, mn = 1e9; for (let i = 0; i < n; i++) { mx = Math.max(mx, Xc[i * 2]); mn = Math.min(mn, Xc[i * 2]); } lastSpread = mx - mn; }
});
const tLay = performance.now() - t;
let bad2 = 0; for (let i = 0; i < n * 2; i++) if (!Number.isFinite(X[i])) bad2++;
check(bad2 === 0, 'layout: no NaN/Inf coordinates');
check(lastSpread > 1e-3 && lastSpread < 1e6, `layout: bounded spread (${lastSpread.toFixed(1)} units)`);

// 2D separation: is the map actually readable, or a hairball?
const cent = Array.from({ length: k }, () => [0, 0, 0]);
for (let i = 0; i < n; i++) { const c = cent[lab[i]]; c[0] += X[i * 2]; c[1] += X[i * 2 + 1]; c[2]++; }
cent.forEach(c => { c[0] /= c[2]; c[1] /= c[2]; });
let within = 0;
for (let i = 0; i < n; i++) within += Math.hypot(X[i * 2] - cent[lab[i]][0], X[i * 2 + 1] - cent[lab[i]][1]);
within /= n;
let between = 0, pairs = 0;
for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) { between += Math.hypot(cent[a][0] - cent[b][0], cent[a][1] - cent[b][1]); pairs++; }
between /= pairs;
line(`  layout ${tLay.toFixed(0)} ms (90 epochs) · between/within = ${(between / within).toFixed(2)}`);
check(between / within > 1.2, `layout separates fields (ratio ${(between / within).toFixed(2)} > 1.2)`);

// ---- sessionize, both branches
const visits = [];
pages.forEach((p, i) => { for (let v = 0; v < 3; v++) visits.push({ url: p.url, title: p.title, ts: p.first + v * 4e5, vid: visits.length + 1, src: v ? visits.length : null }); });
const chained = mod.sessionize(visits);
check(chained.mode === 'from_visit chains', `sessionize: chain branch taken (${chained.sessions.size} sessions)`);
const flatV = visits.map(v => ({ ...v, src: null }));
const gapped = mod.sessionize(flatV);
check(gapped.mode === '30-min gaps', `sessionize: gap fallback taken (${gapped.sessions.size} sessions)`);
check([...chained.sessions.values()].every(s => s.length > 0) && chained.urlToSession.size === pages.length,
  'sessionize: every page maps to exactly one session');

// cycle safety — a corrupted from_visit loop must not hang
const loop = [{ url: 'a', title: 'a', ts: 1, vid: 1, src: 2 }, { url: 'b', title: 'b', ts: 2, vid: 2, src: 1 }];
const tl = performance.now();
mod.sessionize(loop);
check(performance.now() - tl < 500, 'sessionize: survives a from_visit cycle without hanging');

// ---- verdict
line('');
ok.forEach(m => line(`  PASS  ${m}`));
bad.forEach(m => line(`  FAIL  ${m}`));
line('');
line(`${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
