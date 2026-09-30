/**
 * AIDEV-SPIKE: how big can the plate get before it stops feeling interactive?
 * Runs the shipped kNN + layout at increasing n. Node is a rough stand-in for
 * a browser main thread — same JIT family, no WebGPU. Treat as an upper bound
 * on n, not a promise about wall-clock in Chrome.
 */
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('./popmind-spike.html', import.meta.url), 'utf8')
  .match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const at = label => script.match(new RegExp(`^// ─+ *${label}.*$`, 'm')).index;
const core = script.slice(script.indexOf('const STOP = new Set'), at('5\\. render'));

const mod = await import('data:text/javascript,' + encodeURIComponent(`
  const yieldUI = () => Promise.resolve();
  ${core}
  export { lexicalVectors, randomProject, knn, layout, kmeans, silhouette };
`));

const WORDS = ('kubernetes airflow parquet duckdb tap adql fits asdf eks aurora s3 dag scheduler ' +
  'peerjs webrtc hypertrophy creatine tendon moc hats iceberg zarr firefly roman euclid spherex ' +
  'cutout soda votable pyvo astropy lambda eventbridge cloudwatch jenkins terraform pytest uv ' +
  'benchmark latency throughput index partition schema migration rollback retry backoff quota')
  .split(' ');
const HOSTS = ['github.com','docs.aws.amazon.com','kubernetes.io','duckdb.org','ivoa.net',
  'stackoverflow.com','news.ycombinator.com','readthedocs.io','examine.com','reddit.com'];
let s = 777;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[(rnd() * a.length) | 0];
const makePages = n => Array.from({ length: n }, (_, i) => ({
  url: `https://x/${i}`, host: pick(HOSTS), n: 1 + ((rnd() * 5) | 0),
  first: 0, last: i,
  title: Array.from({ length: 4 + ((rnd() * 5) | 0) }, () => pick(WORDS)).join(' '),
}));

const ms = t => `${t.toFixed(0)} ms`.padStart(9);
console.log('n        embed      kNN(k=15)   layout(90)  kmeans     silhouette  total');
console.log('-'.repeat(76));
for (const n of [1000, 2000, 4000, 8000, 16000]) {
  const pages = makePages(n);
  let t = performance.now();
  const v = mod.lexicalVectors(pages);
  const tE = performance.now() - t;

  t = performance.now();
  const P = mod.randomProject(v.V, n, v.dim, 64);
  const nb = await mod.knn(P, n, 64, 15, () => {});
  const tK = performance.now() - t;

  t = performance.now();
  await mod.layout(nb, n, 90, () => {});
  const tL = performance.now() - t;

  t = performance.now();
  const lab = mod.kmeans(v.V, n, v.dim, 10);
  const tM = performance.now() - t;

  t = performance.now();
  mod.silhouette(v.V, n, v.dim, lab, 10);
  const tS = performance.now() - t;

  const tot = tE + tK + tL + tM + tS;
  console.log(`${String(n).padEnd(8)}${ms(tE)}${ms(tK)}${ms(tL)}${ms(tM)}${ms(tS)}` +
    `   ${(tot / 1000).toFixed(1)} s`);
}
console.log('\nkNN is O(n²) — it is the wall. Everything else is linear-ish.');
