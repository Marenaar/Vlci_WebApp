# Vlci – šipkařský tým

Statický web (GitHub Pages) s tabulkou a nejbližšími zápasy ze sipky.org.

## Nasazení
1. Nový repozitář na GitHubu, nahrát celý obsah této složky (včetně skryté složky `.github`).
2. Settings → Pages → Source: *Deploy from a branch*, větev `main`, složka `/ (root)`.
3. Settings → Actions → General → Workflow permissions → *Read and write permissions*.
4. Záložka Actions → *Aktualizace dat ze sipky.org* → Run workflow (první ruční spuštění ověří import).

## Jak to funguje
- `scripts/fetch_data.py` stáhne tabulku a rozpis a uloží `data.json`. Při chybě `data.json` nepřepíše a běh skončí chybou.
- `.github/workflows/update-data.yml` ho spouští každé 3 hodiny a změnu commitne.
- `scripts/config.json`: ID ligy a týmu. S novou sezónou stačí změnit `league` (a případně `team_id`).
- Lokální test: `python scripts/fetch_data.py`
