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

## Databáze a přihlášení (Supabase)
1. Na supabase.com založ projekt (free), region EU.
2. SQL Editor → vlož celý `supabase/setup.sql` → Run. Výsledkem je tabulka **úvodních PINů** (zobrazí se jen jednou, ulož si ji).
3. Project Settings → API: zkopíruj *Project URL* a *anon / publishable key* do `assets/config.js`. Klíč `service_role` / `secret` nikdy nedávej do webu.
4. Commit a push. Hráči se přihlásí jménem + úvodním PINem a hned si ho změní.

Tabulky jsou před webem zavřené (zapnutá RLS bez politik). Web smí jen volat funkce v `setup.sql`, které kontrolují přihlášení a práva.

## Aktualizace verze 4 (karty, historie, statistiky, přezdívky)
- Spusť znovu celý `supabase/setup.sql` (je bezpečné: nemaže data, nemění PINy, hráče zakládá jen do prázdné tabulky).
- `assets/config.js` se nepřepisuje (jsou v něm tvoje klíče).
- Po nasazení spusť ručně workflow *Aktualizace dat ze sipky.org*; historie zápasů se sbírá a slučuje, starší záznamy se nemažou.

## Seznam verzí
`changelog.json`: nová verze se přidává **na začátek** seznamu (pole `new` = nové věci, `fix` = opravy). První záznam se zobrazí v patičce jako aktuální verze. Při změně skriptů nebo stylů zvyš také číslo `?v=` v `index.html`, aby si prohlížeče stáhly čerstvé soubory.
