#!/usr/bin/env python3
"""Regenerate scans/README.md from the before/after manifests."""
import json, os, sys
from collections import Counter
E = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scans')
def load(side, s):
    p = f'{E}/{side}/{s}/hook-risk.json'
    return json.load(open(p)) if os.path.exists(p) else None
ORDER = ['critical', 'high', 'medium', 'low', 'info']
def sev(m):
    c = Counter(f['severity'] for f in m['findings'] if f['ruleClass'] != 'hook-profile')
    return ", ".join(f"{v} {k}" for k, v in sorted(c.items(), key=lambda x: ORDER.index(x[0]))) or "none"
def harness(m):
    e = [x for x in m['engines'] if x['engine'] == 'harness']
    if e: return e[0]['status']
    inv = m.get('invariants')
    return "ok (0 invariants!)" if not inv else ("skipped" if all(i['status'] == 'skipped' for i in inv) else "ok")
def inv(m): return ", ".join(f"{i['id']} {i['status']}" for i in (m.get('invariants') or [])) or "—"
def comp(m):
    d = [x for x in m['score']['dimensions'] if x['id'] == 'complexity'][0]
    return f"{d['value']}/5" if d['value'] is not None else "—"
def probes(m):
    p = (m.get('permissions') or {}).get('harnessRun', {}).get('probes')
    if not p: return "—"
    eoa = Counter(p['eoaGuard'].values()); sel = Counter(p['selectors'].values())
    return f"guard {dict(eoa)} · selectors {dict(sel)} · exclusivity {p['exclusivity']}".replace("'", "")
def dims(m):
    c = Counter(d['source'] for d in m['score']['dimensions'])
    return f"{c.get('measured',0)}m/{c.get('declared',0)}d/{c.get('unmeasured',0)}u"
rows = ["| Hook | Findings before | Findings after | Harness | Invariants | Probes | Complexity | Dimensions | Gate | Tier band |", "|---|---|---|---|---|---|---|---|---|---|"]
for s in sorted(os.listdir(f'{E}/after')):
    b, a = load('before', s), load('after', s)
    if not a: continue
    run = (a.get('permissions') or {}).get('harnessRun')
    rows.append(f"| {s} | {sev(b) if b else '— (new)'} | {sev(a)} | {harness(a)}{' ('+run['seeded']+')' if run else ''} | {inv(a)} | {probes(a)} | {comp(a)} | {dims(a)} | {'passed' if a['gate']['passed'] else 'failed'} | {a['score']['tier']} {a['score']['total']}–{a['score']['totalUpperBound']} |")
head = ("# 15 real hooks, before and after\n\nSame clones, `hookrisk.toml` regenerated with the final `init` template (Orbital and LiquidityPenaltyHookMock add `[harness] constructorArgs`, copies are in their directories), scanned with `main@db08091` (before) and the final `feat/hackathon-p0` (after). Each directory holds `hook-risk.json`, `HOOK_RISK.md` and the verbose `scan.stderr`; `after/summary.jsonl` is the machine-readable summary. Regenerate the scans with `../rescan.sh <hookrisk-root> <clones-root> <out-dir>` and this table with `../make-table.py`. Finding counts exclude the informational `hook-profile` every recognised hook carries. Probes are the harness's execution probes (EOA guard per callback, selector/return check per callback, pool-key exclusivity). Dimensions are counted measured/declared/unmeasured.\n\n")
tail = ("\n\nThe gate fails on the three hooks with HIGH findings (Cork, StablePairHook, v2-on-v4) and on the five that could not be analysed (four 2023-ABI hooks and the repo that does not compile), and passes on the seven that were measured. v2-on-v4's three HS-03 HIGHs are its Uniswap-v2-style `mint`/`burn`/`sync`, permissionless by that design; the detector cannot tell them from an open admin surface because the caller pays by transferring beforehand rather than in the call (documented limit).\n")
open(f'{E}/README.md', 'w').write(head + "\n".join(rows) + tail)
print("table written")
