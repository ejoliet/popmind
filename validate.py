"""
AIDEV-SPIKE: validates the three load-bearing assumptions of popmind's import path.

A1  One SQL shape per browser can be auto-detected and normalized to a common row.
A2  The three timestamp epochs convert correctly to Unix ms.
A3  Title-only text is enough signal to cluster into recognizable topics.
    (TF-IDF here as an offline proxy for MiniLM embeddings; if TF-IDF already
     separates, embeddings will do strictly better.)
"""
import sqlite3, os, datetime, collections
import numpy as np

OUT = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- fixtures
TOPICS = {
    "kubernetes": [
        ("https://kubernetes.io/docs/concepts/workloads/pods/", "Pods | Kubernetes"),
        ("https://kubernetes.io/docs/tasks/debug/debug-cluster/", "Troubleshooting Clusters | Kubernetes"),
        ("https://stackoverflow.com/q/1", "kubectl rollout restart deployment not picking up new image"),
        ("https://github.com/kubernetes/kubernetes/issues/2", "CrashLoopBackOff with no logs · Issue · kubernetes/kubernetes"),
        ("https://aws.amazon.com/eks/", "Amazon EKS - Managed Kubernetes Service"),
        ("https://docs.aws.amazon.com/eks/latest/userguide/managed-node-groups.html", "Managed node groups - Amazon EKS"),
    ],
    "airflow": [
        ("https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html", "DAGs — Airflow Documentation"),
        ("https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html", "Best Practices — Airflow Documentation"),
        ("https://github.com/apache/airflow/discussions/3", "Dynamic task mapping with large fan-out · apache/airflow"),
        ("https://stackoverflow.com/q/4", "Airflow scheduler stuck on queued tasks in Kubernetes executor"),
        ("https://medium.com/x/5", "Testing Airflow DAGs without a running scheduler"),
    ],
    "astronomy_data": [
        ("https://www.ivoa.net/documents/TAP/", "IVOA Table Access Protocol"),
        ("https://pyvo.readthedocs.io/en/latest/", "PyVO: Astronomical data access — pyvo documentation"),
        ("https://docs.astropy.org/en/stable/io/fits/", "FITS File Handling — Astropy"),
        ("https://asdf.readthedocs.io/en/latest/", "ASDF: Advanced Scientific Data Format"),
        ("https://irsa.ipac.caltech.edu/frontpage/", "IRSA - NASA/IPAC Infrared Science Archive"),
        ("https://github.com/astronomy-commons/lsdb", "astronomy-commons/lsdb: HATS catalog analysis"),
    ],
    "duckdb_parquet": [
        ("https://duckdb.org/docs/extensions/httpfs.html", "httpfs Extension – DuckDB"),
        ("https://duckdb.org/2021/06/25/querying-parquet.html", "Querying Parquet with Precision using DuckDB"),
        ("https://parquet.apache.org/docs/file-format/", "File Format | Apache Parquet"),
        ("https://github.com/duckdb/duckdb-wasm", "duckdb/duckdb-wasm: WebAssembly version of DuckDB"),
        ("https://news.ycombinator.com/item?id=6", "DuckDB-WASM in the browser | Hacker News"),
    ],
    "soccer_fitness": [
        ("https://www.strongerbyscience.com/hypertrophy/", "Hypertrophy Training Guide - Stronger By Science"),
        ("https://examine.com/supplements/creatine/", "Creatine - Health benefits, dosage, side effects"),
        ("https://pubmed.ncbi.nlm.nih.gov/7", "Effects of resistance training on tendon stiffness - PubMed"),
        ("https://www.reddit.com/r/bootroom/comments/8", "Best warmup routine before a soccer match : r/bootroom"),
        ("https://examine.com/supplements/collagen/", "Collagen supplementation and joint pain: evidence review"),
    ],
    "webrtc_p2p": [
        ("https://peerjs.com/docs/", "PeerJS Documentation"),
        ("https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection", "RTCPeerConnection - Web APIs | MDN"),
        ("https://github.com/peers/peerjs/issues/9", "Connection fails behind symmetric NAT · peers/peerjs"),
        ("https://webrtc.org/getting-started/turn-server", "TURN server - WebRTC"),
        ("https://news.ycombinator.com/item?id=10", "Show HN: zero-backend file transfer over WebRTC"),
    ],
}

CHROME_EPOCH_OFFSET_MS = 11644473600000   # 1601-01-01 -> 1970-01-01
MAC_EPOCH_OFFSET_S = 978307200            # 2001-01-01 -> 1970-01-01


def flat():
    rows = []
    base = datetime.datetime(2026, 2, 1, tzinfo=datetime.timezone.utc)
    t = 0
    for topic, pages in TOPICS.items():
        for i, (url, title) in enumerate(pages):
            ts = base + datetime.timedelta(days=t // 4, minutes=(t % 4) * 7)
            rows.append((url, title, ts, topic, i))
            t += 1
    return rows


def make_chrome(path):
    if os.path.exists(path):
        os.remove(path)
    c = sqlite3.connect(path)
    c.executescript("""
    CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR,
      title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL,
      typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL,
      hidden INTEGER DEFAULT 0 NOT NULL);
    CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER NOT NULL,
      visit_time INTEGER NOT NULL, from_visit INTEGER, transition INTEGER DEFAULT 0 NOT NULL,
      segment_id INTEGER, visit_duration INTEGER DEFAULT 0 NOT NULL);
    """)
    vid = 0
    prev = None
    for url, title, ts, topic, i in flat():
        chrome_ts = int(ts.timestamp() * 1_000_000) + CHROME_EPOCH_OFFSET_MS * 1000
        cur = c.execute("INSERT INTO urls(url,title,visit_count,typed_count,last_visit_time)"
                        " VALUES(?,?,?,?,?)", (url, title, 1, 0, chrome_ts))
        uid = cur.lastrowid
        vid += 1
        # i==0 starts a new chain (typed=1), rest are link clicks (0) from previous
        from_visit = 0 if i == 0 else prev
        c.execute("INSERT INTO visits(id,url,visit_time,from_visit,transition,visit_duration)"
                  " VALUES(?,?,?,?,?,?)", (vid, uid, chrome_ts, from_visit,
                                           1 if i == 0 else 0, 45_000_000))
        prev = vid
    c.commit(); c.close()


def make_firefox(path):
    if os.path.exists(path):
        os.remove(path)
    c = sqlite3.connect(path)
    c.executescript("""
    CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR,
      rev_host LONGVARCHAR, visit_count INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0 NOT NULL,
      typed INTEGER DEFAULT 0 NOT NULL, frecency INTEGER DEFAULT -1 NOT NULL,
      last_visit_date INTEGER, guid TEXT);
    CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY, from_visit INTEGER,
      place_id INTEGER, visit_date INTEGER, visit_type INTEGER, session INTEGER);
    """)
    vid = 0; prev = None
    for pid, (url, title, ts, topic, i) in enumerate(flat(), start=1):
        moz_ts = int(ts.timestamp() * 1_000_000)   # PRTime = microseconds since Unix epoch
        c.execute("INSERT INTO moz_places(id,url,title,rev_host,visit_count,last_visit_date)"
                  " VALUES(?,?,?,?,?,?)", (pid, url, title, "", 1, moz_ts))
        vid += 1
        c.execute("INSERT INTO moz_historyvisits(id,from_visit,place_id,visit_date,visit_type)"
                  " VALUES(?,?,?,?,?)", (vid, 0 if i == 0 else prev, pid, moz_ts, 2 if i == 0 else 1))
        prev = vid
    c.commit(); c.close()


def make_safari(path):
    if os.path.exists(path):
        os.remove(path)
    c = sqlite3.connect(path)
    c.executescript("""
    CREATE TABLE history_items(id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE,
      domain_expansion TEXT NULL, visit_count INTEGER NOT NULL, daily_visit_counts BLOB NULL);
    CREATE TABLE history_visits(id INTEGER PRIMARY KEY AUTOINCREMENT,
      history_item INTEGER NOT NULL, visit_time REAL NOT NULL, title TEXT NULL,
      load_successful BOOLEAN DEFAULT 1, redirect_source INTEGER NULL,
      redirect_destination INTEGER NULL);
    """)
    for iid, (url, title, ts, topic, i) in enumerate(flat(), start=1):
        mac_ts = ts.timestamp() - MAC_EPOCH_OFFSET_S   # seconds since 2001-01-01
        c.execute("INSERT INTO history_items(id,url,visit_count) VALUES(?,?,?)", (iid, url, 1))
        c.execute("INSERT INTO history_visits(history_item,visit_time,title) VALUES(?,?,?)",
                  (iid, mac_ts, title))
    c.commit(); c.close()


# ------------------------------------------------- detection + normalization
def tables(con):
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


FLAVORS = {
    "chrome": (lambda t: {"urls", "visits"} <= t, """
        SELECT u.url, u.title,
               v.visit_time/1000 - 11644473600000 AS ts_ms,
               v.id, NULLIF(v.from_visit,0)
        FROM visits v JOIN urls u ON u.id = v.url
        WHERE u.title IS NOT NULL AND u.title <> ''
        ORDER BY ts_ms"""),
    "firefox": (lambda t: {"moz_places", "moz_historyvisits"} <= t, """
        SELECT p.url, p.title,
               v.visit_date/1000 AS ts_ms,
               v.id, NULLIF(v.from_visit,0)
        FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
        WHERE p.title IS NOT NULL AND p.title <> ''
        ORDER BY ts_ms"""),
    "safari": (lambda t: {"history_items", "history_visits"} <= t, """
        SELECT i.url, v.title,
               CAST((v.visit_time + 978307200) * 1000 AS INTEGER) AS ts_ms,
               v.id, v.redirect_source
        FROM history_visits v JOIN history_items i ON i.id = v.history_item
        WHERE v.title IS NOT NULL AND v.title <> ''
        ORDER BY ts_ms"""),
}


def load(path):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    t = tables(con)
    for name, (probe, sql) in FLAVORS.items():
        if probe(t):
            rows = con.execute(sql).fetchall()
            con.close()
            return name, rows
    con.close()
    raise SystemExit(f"unrecognized history schema in {path}: {sorted(t)}")


# ----------------------------------------------------------------- checks
def main():
    print("=" * 68)
    print("A1/A2  schema detection + epoch normalization")
    print("=" * 68)
    truth = {url: (title, ts) for url, title, ts, _, _ in flat()}
    paths = {"chrome": "History", "firefox": "places.sqlite", "safari": "History.db"}
    builders = {"chrome": make_chrome, "firefox": make_firefox, "safari": make_safari}
    loaded = {}
    for flavor, fname in paths.items():
        p = os.path.join(OUT, fname)
        builders[flavor](p)
        detected, rows = load(p)
        assert detected == flavor, f"{flavor} misdetected as {detected}"
        # epoch check: every row must land within 1s of the truth timestamp
        worst = 0
        for url, title, ts_ms, vid, frm in rows:
            want = truth[url][1].timestamp() * 1000
            worst = max(worst, abs(ts_ms - want))
        span = (min(r[2] for r in rows), max(r[2] for r in rows))
        fmt = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
        edges = sum(1 for r in rows if r[4])
        print(f"  {flavor:8s} {len(rows):3d} visits  {fmt(span[0])}..{fmt(span[1])}  "
              f"epoch drift {worst:.0f} ms  trail edges {edges}")
        assert worst < 1000, f"{flavor} epoch conversion off by {worst} ms"
        loaded[flavor] = rows

    # cross-browser agreement: identical logical history -> identical normalized rows
    key = lambda rows: sorted((u, t, int(ms // 1000)) for u, t, ms, _, _ in rows)
    assert key(loaded["chrome"]) == key(loaded["firefox"]) == key(loaded["safari"])
    print("  cross-browser: chrome == firefox == safari after normalization  OK")

    print()
    print("=" * 68)
    print("A3  title-only clustering (TF-IDF proxy for MiniLM embeddings)")
    print("=" * 68)
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.cluster import KMeans
    from sklearn.metrics import adjusted_rand_score, silhouette_score

    rows = loaded["chrome"]
    titles = [t for _, t, _, _, _ in rows]
    urls = [u for u, _, _, _, _ in rows]
    t2topic = {t: topic for _, t, _, topic, _ in flat()}
    y_true = [t2topic[t] for t in titles]

    # host token helps a lot and is free -> feed "title + host"
    host = lambda u: u.split("/")[2].replace("www.", "")
    docs = [f"{t} {host(u)}" for t, u in zip(titles, urls)]

    vec = TfidfVectorizer(stop_words="english", sublinear_tf=True,
                          ngram_range=(1, 2), min_df=1, token_pattern=r"[A-Za-z][A-Za-z0-9_.-]+")
    X = vec.fit_transform(docs)
    Xn = X.toarray()
    Xn /= (np.linalg.norm(Xn, axis=1, keepdims=True) + 1e-9)

    k = len(TOPICS)
    km = KMeans(n_clusters=k, n_init=20, random_state=0).fit(Xn)
    ari = adjusted_rand_score(y_true, km.labels_)
    sil = silhouette_score(Xn, km.labels_, metric="cosine")
    print(f"  docs={len(docs)}  k={k}  ARI vs ground truth = {ari:.2f}  silhouette = {sil:.2f}")

    terms = np.array(vec.get_feature_names_out())
    for c in range(k):
        members = [i for i, l in enumerate(km.labels_) if l == c]
        centroid = Xn[members].mean(axis=0)
        top = terms[np.argsort(-centroid)[:4]]
        majority = collections.Counter(y_true[i] for i in members).most_common(1)[0]
        print(f"   c{c}  n={len(members):2d}  label≈ {', '.join(top):<52s} "
              f"true={majority[0]} ({majority[1]}/{len(members)})")

    # char n-gram + LSA: better than word TF-IDF on short strings
    from sklearn.decomposition import TruncatedSVD
    cvec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
    Xc = TruncatedSVD(n_components=12, random_state=0).fit_transform(cvec.fit_transform(docs))
    Xc /= (np.linalg.norm(Xc, axis=1, keepdims=True) + 1e-9)
    ari_c = adjusted_rand_score(y_true, KMeans(k, n_init=20, random_state=0).fit(Xc).labels_)
    print(f"  char3-5 + LSA(12):  ARI = {ari_c:.2f}")

    print(f"\n  nearest-neighbour spot check (word TF-IDF, cosine):")
    S = Xn @ Xn.T
    np.fill_diagonal(S, -1)
    for i in (0, 8, 14, 22, 27):
        j = int(S[i].argmax())
        hit = "same" if y_true[i] == y_true[j] else "CROSS"
        print(f"   [{hit:5s}] {titles[i][:44]:<44s} -> {titles[j][:44]}")

    print(f"\n  A3 verdict: sparse lexical methods top out at ARI ~{max(ari, ari_c):.2f} on "
          f"{len(docs)} short titles.")
    print("  Not a pass, and not a fail either: TF-IDF is the FLOOR, not the proxy I hoped for.")
    print("  Short titles share too few literal tokens. A3 must be settled in-browser with")
    print("  real MiniLM embeddings on real history (the HTML spike measures it directly).")

    print()
    print("=" * 68)
    print("A4  session reconstruction (universal fallback where from_visit is absent)")
    print("=" * 68)
    for flavor in ("chrome", "safari"):
        rows = loaded[flavor]
        # explicit chains where available
        chained = sum(1 for r in rows if r[4])
        # 30-minute inactivity gap sessionization on ts only
        ts = sorted(r[2] for r in rows)
        gap_ms = 30 * 60 * 1000
        sessions = 1 + sum(1 for a, b in zip(ts, ts[1:]) if b - a > gap_ms)
        sizes = []
        cur = 1
        for a, b in zip(ts, ts[1:]):
            if b - a > gap_ms:
                sizes.append(cur); cur = 1
            else:
                cur += 1
        sizes.append(cur)
        print(f"  {flavor:8s} from_visit edges={chained:3d}   time-gap sessions={sessions:3d}  "
              f"median len={int(np.median(sizes))}")
    print("  -> Chrome/Firefox get true trails; Safari degrades to time-gap sessions. Both usable.")


if __name__ == "__main__":
    main()
