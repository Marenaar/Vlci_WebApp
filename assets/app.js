const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const DAYS = ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
const when = m => new Date(m.date + 'T' + (m.time || '12:00') + ':00');
const fmt = m => { const d = when(m); return `${DAYS[d.getDay()]} ${d.getDate()}. ${d.getMonth()+1}. ${d.getFullYear()} · <b>${m.time}</b>`; };
const short = m => { const d = when(m); return `${DAYS[d.getDay()].slice(0,2)} ${d.getDate()}. ${d.getMonth()+1}.`; };
const inDays = m => { const a = new Date(); a.setHours(0,0,0,0); const b = when(m); b.setHours(0,0,0,0); return Math.round((b - a) / 864e5); };
const cz = n => n === 0 ? 'dnes' : n === 1 ? 'zítra' : `za ${n} ${n < 5 ? 'dny' : 'dní'}`;
const maps = m => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((m.place.name.split(',')[0] + ' ' + (m.place.address || m.place.name.split(',')[1] || '')).trim());
const place = m => `<a href="${maps(m)}" target="_blank" rel="noopener">${esc(m.place.name)}${m.place.address ? ', ' + esc(m.place.address) : ''}</a>`;
const badge = home => `<span class="chip ${home ? 'on' : ''}">${home ? 'DOMA' : 'VENKU'}</span>`;

/* ---------- záložky (hash: #zapas #tabulka #historie #statistiky #profil) ---------- */
const TABS = ['zapas', 'tabulka', 'historie', 'statistiky', 'profil'];
function route() {
  const t = (location.hash || '#zapas').slice(1), cur = TABS.includes(t) ? t : 'zapas';
  TABS.forEach(x => {
    document.getElementById('t-' + x).hidden = x !== cur;
    const a = document.querySelector(`.nav [data-t="${x}"]`);
    if (x === cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('vlci-tab', { detail: cur }));
}
addEventListener('hashchange', route);
route();

/* ---------- vykreslení ---------- */
function render(d) {
  const me = d.team.id;
  const upcoming = d.next_matches.filter(m => inDays(m) >= 0);
  const [next, ...rest] = upcoming;

  $('#next').innerHTML = next ? (() => {
    const home = next.home.id === me, opp = home ? next.away : next.home;
    return `<div class="top"><span class="lab">Příští zápas · ${next.round}. kolo</span>${badge(home)}</div>
      <h2 class="h vs">${esc(d.team.name)}<small>proti</small>${esc(opp.name)}</h2>
      <div>${fmt(next)}<br><span class="dim">${place(next)}</span></div>
      <p class="lab">${cz(inDays(next))}</p>`;
  })() : '<p class="dim">Žádný další zápas v rozpisu.</p>';

  $('#more').innerHTML = rest.length ? '<h2 class="h">Další zápasy</h2>' + rest.slice(0, 6).map(m => {
    const home = m.home.id === me, opp = home ? m.away : m.home;
    return `<div class="m"><div><b>${short(m)} · ${m.time}</b><br>
      <small>${esc(d.team.name)} – ${esc(opp.name)}<br>${esc(m.place.name)}</small></div>${badge(home)}</div>`;
  }).join('') : '';
  $('#more').hidden = !rest.length;

  $('#table').innerHTML = `<div class="top"><h2 class="h">Tabulka</h2>
    <span class="dim">${d.source_sync ? 'sipky.org · ' + esc(d.source_sync) : ''}</span></div>
    <div class="t hd"><span>#</span><span>Družstvo</span><span>Z</span><span>Skóre</span><span>B</span></div>` +
    d.standings.map(s => `<div class="t ${s.id === me ? 'me' : ''}"><span>${s.rank}</span><span>${esc(s.name)}</span>
      <span>${s.played}</span><span>${s.score[0]}:${s.score[1]}</span><span>${s.points}</span></div>`).join('');

  const hist = d.history || [];
  const res = h => { const home = h.home.id === me; const diff = (home ? h.score[0] - h.score[1] : h.score[1] - h.score[0]); return diff > 0 ? 'w' : diff < 0 ? 'l' : 'd'; };
  const cnt = k => hist.filter(h => res(h) === k).length;
  $('#history').innerHTML = `<h2 class="h">Historie zápasů</h2>` + (hist.length
    ? `<p class="dim">Výhry ${cnt('w')} · Remízy ${cnt('d')} · Prohry ${cnt('l')}</p>` + hist.map(h => {
        const r = res(h), home = h.home.id === me;
        return `<div class="m"><div><b>${short(h)}</b> · ${h.round}. kolo ${badge(home)}<br>
          <small>${esc(h.home.name)} <b>${h.score[0]} : ${h.score[1]}</b> ${esc(h.away.name)}</small>
          ${h.match_id ? `<br><small><a href="https://www.sipky.org/?region=jmoss&page=detail-zapisu-ligoveho-utkani&league_match=${h.match_id}" target="_blank" rel="noopener">zápis na sipky.org</a></small>` : ''}</div>
          <span class="chip ${r === 'w' ? 'on' : r === 'l' ? 'off' : 'wait'}">${r === 'w' ? 'Výhra' : r === 'l' ? 'Prohra' : 'Remíza'}</span></div>`;
      }).join('')
    : '<p class="dim">Odehrané zápasy se zde objeví po prvním zápase, který import zachytí.</p>');

  $('#foot').innerHTML = `Data: <a href="${esc(d.source_url)}" target="_blank" rel="noopener">sipky.org (UŠO)</a>, obnovují se automaticky každé 3 hodiny.`;
  window.VLCI_DATA = d;
  document.dispatchEvent(new Event('vlci-data'));
}

fetch('data.json', { cache: 'no-cache' })
  .then(r => r.json()).then(render)
  .catch(() => { $('#next').innerHTML = '<p class="dim">Data se nepodařilo načíst.</p>'; });
