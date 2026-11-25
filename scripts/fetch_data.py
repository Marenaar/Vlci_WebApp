#!/usr/bin/env python3
"""Stáhne tabulku a rozpis ze sipky.org a uloží je do data.json.
Bez externích knihoven. Při chybě parsování data.json NEPŘEPÍŠE a skončí chybou."""
import json, re, sys, urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((Path(__file__).parent / "config.json").read_text(encoding="utf-8"))


class Tables(HTMLParser):
    """Sbírá tabulky jako [řádky][buňky]{t: text, links: [href]}; zvládá vnořené tabulky."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.done, self.a_cell = [], [], None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.stack.append([])
        elif not self.stack:
            return
        elif tag == "tr":
            self.stack[-1].append([])
        elif tag in ("td", "th") and self.stack[-1]:
            self.stack[-1][-1].append({"t": "", "links": [], "a": ""})
        elif tag == "a" and self.stack[-1] and self.stack[-1][-1]:
            cell = self.stack[-1][-1][-1]
            href = dict(attrs).get("href")
            if href:
                cell["links"].append(href)
            self.a_cell = cell if not cell["a"] else None
        elif tag == "br":
            self.handle_data(" ")

    def handle_endtag(self, tag):
        if tag == "a":
            self.a_cell = None
        if tag == "table" and self.stack:
            self.done.append(self.stack.pop())

    def handle_data(self, d):
        if self.a_cell is not None:
            self.a_cell["a"] += d
        if self.stack and self.stack[-1] and self.stack[-1][-1]:
            self.stack[-1][-1][-1]["t"] += d


def tables(html):
    p = Tables()
    p.feed(html)
    return [t for t in p.done if t]


def clean(c):
    return re.sub(r"\s+", " ", c["t"]).strip()


def num(s):
    m = re.search(r"\d+", s)
    return int(m.group(0)) if m else 0


def link_id(cell, key):
    for l in cell["links"]:
        m = re.search(key + r"=(\d+)", l)
        if m:
            return int(m.group(1))


def parse_standings(html):
    for t in tables(html):
        head = [clean(c) for c in t[0]]
        if not {"Pořadí", "Družstvo", "Body"} <= set(head):
            continue
        out = []
        for r in t[1:]:
            txt = [clean(c) for c in r]
            if len(r) < 10:
                continue
            pairs = re.findall(r"(\d+)\s*:\s*(\d+)", " ".join(txt[8:]))
            if len(pairs) < 2:
                continue
            out.append({
                "rank": num(txt[0]), "id": link_id(r[1], "league_team"), "name": txt[1],
                "played": num(txt[2]), "wins": num(txt[3]) + num(txt[4]), "draws": num(txt[5]),
                "losses": num(txt[6]) + num(txt[7]),
                "score": [int(pairs[0][0]), int(pairs[0][1])],
                "legs": [int(pairs[1][0]), int(pairs[1][1])],
                "points": num([x for x in txt if x][-1]),
            })
        if out:
            return out
    return []


def parse_matches(html):
    out = []
    for t in tables(html):
        head = [clean(c) for c in t[0]]
        idx = {}
        for i, h in enumerate(head):
            for k in ("Datum", "Čas", "Kolo", "Domácí", "Hosté", "Hrací místo"):
                if h.startswith(k):
                    idx.setdefault(k, i)
        if len(idx) < 6:
            continue
        for r in t[1:]:
            if len(r) <= max(idx.values()):
                continue
            d = re.match(r"(\d+)\.(\d+)\.(\d{4})", clean(r[idx["Datum"]]))
            tm = re.search(r"(\d+):(\d+)", clean(r[idx["Čas"]]))
            if not d or not tm:
                continue
            pid = link_id(r[idx["Hrací místo"]], "place")
            out.append({
                "date": f"{d.group(3)}-{int(d.group(2)):02d}-{int(d.group(1)):02d}",
                "time": f"{int(tm.group(1)):02d}:{tm.group(2)}",
                "round": num(clean(r[idx["Kolo"]])),
                "home": {"id": link_id(r[idx["Domácí"]], "league_team"), "name": clean(r[idx["Domácí"]])},
                "away": {"id": link_id(r[idx["Hosté"]], "league_team"), "name": clean(r[idx["Hosté"]])},
                "place": {"id": pid, "name": clean(r[idx["Hrací místo"]]),
                          "address": CFG.get("venues", {}).get(str(pid))},
            })
    return out


def team_name(cell):
    return re.sub(r"\s+", " ", cell["a"]).strip() or clean(cell)


def parse_results(html):
    """Odehraná utkání: tabulka s Datum, Domácí, Skóre (nebo Výsledek), Hosté."""
    out = []
    for t in tables(html):
        head = [clean(c) for c in t[0]]
        idx = {}
        for i, h in enumerate(head):
            for k in ("Datum", "Čas", "Kolo", "Domácí", "Hosté", "Skóre", "Výsledek"):
                if h.startswith(k):
                    idx.setdefault(k, i)
        sc = idx.get("Skóre", idx.get("Výsledek"))
        if sc is None or not {"Datum", "Domácí", "Hosté"} <= idx.keys():
            continue
        for r in t[1:]:
            if len(r) <= max(idx.values()):
                continue
            d = re.match(r"(\d+)\.(\d+)\.(\d{4})", clean(r[idx["Datum"]]))
            score = re.search(r"(\d+)\s*:\s*(\d+)", clean(r[sc]))
            if not d or not score:
                continue
            tm = re.search(r"(\d+):(\d+)", clean(r[idx["Čas"]])) if "Čas" in idx else None
            mid = next((link_id(c, "league_match") for c in r if link_id(c, "league_match")), None)
            out.append({
                "date": f"{d.group(3)}-{int(d.group(2)):02d}-{int(d.group(1)):02d}",
                "time": f"{int(tm.group(1)):02d}:{tm.group(2)}" if tm else "00:00",
                "round": num(clean(r[idx["Kolo"]])) if "Kolo" in idx else 0,
                "home": {"id": link_id(r[idx["Domácí"]], "league_team"), "name": team_name(r[idx["Domácí"]])},
                "away": {"id": link_id(r[idx["Hosté"]], "league_team"), "name": team_name(r[idx["Hosté"]])},
                "score": [int(score.group(1)), int(score.group(2))],
                "match_id": mid,
            })
    return out


def get(params):
    req = urllib.request.Request(CFG["base"] + "?" + params,
                                 headers={"User-Agent": "VlciApp/1.0 (+https://github.com/Marenaar)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("cp1250", errors="replace")  # sipky.org používá windows-1250


def main():
    base = f"region={CFG['region']}&league={CFG['league']}"
    page = get(base + "&page=ligova-skupina")
    standings, matches, results = parse_standings(page), parse_matches(page), parse_results(page)
    try:
        matches += parse_matches(get(base + "&page=rozpis-utkani&unplayed=1"))
    except Exception as e:  # rozpis je doplněk, tabulka a nejbližší zápasy stačí
        print("Rozpis se nepodařilo načíst:", e, file=sys.stderr)

    try:   # odehraná utkání družstva (pokud web vrátí očekávanou stránku)
        results += parse_results(get(f"region={CFG['region']}&page=rozpis-utkani&league_team={CFG['team_id']}&played=1"))
    except Exception as e:
        print("Historie družstva se nepodařila načíst:", e, file=sys.stderr)

    me = CFG["team_id"]
    if not any(s["id"] == me for s in standings):
        sys.exit("Tabulku se nepodařilo načíst, data.json ponechán beze změny.")

    seen, mine = set(), []
    for m in sorted(matches, key=lambda m: (m["date"], m["time"])):
        key = (m["date"], m["time"], m["home"]["id"], m["away"]["id"])
        if me in (m["home"]["id"], m["away"]["id"]) and key not in seen:
            seen.add(key)
            mine.append(m)

    out = ROOT / "data.json"
    old = {}
    if out.exists():
        try:
            old = json.loads(out.read_text(encoding="utf-8"))
        except ValueError:
            pass
    hist = {(h["date"], h["home"]["id"], h["away"]["id"]): h for h in old.get("history", [])}
    for r in results:   # nové výsledky přepíšou staré; starší záznamy se nikdy nemažou
        if me in (r["home"]["id"], r["away"]["id"]):
            hist[(r["date"], r["home"]["id"], r["away"]["id"])] = r
    history = sorted(hist.values(), key=lambda h: (h["date"], h["time"]), reverse=True)
    print(f"historie: {len(history)} zápasů")

    sync = re.search(r"Poslední synchronizace:\s*(\d+\.\d+\.\d{4}\s+\d+:\d+)", page)
    data = {
        "source_sync": sync.group(1) if sync else None,
        "source_url": f"{CFG['base']}?{base}&page=ligova-skupina",
        "team": {"id": me, "name": CFG["team_name"]},
        "standings": standings,
        "next_matches": mine,
        "history": history,
    }
    new = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    if not out.exists() or out.read_text(encoding="utf-8") != new:
        out.write_text(new, encoding="utf-8")
        print("data.json aktualizován")
    else:
        print("beze změny")


if __name__ == "__main__":
    main()
