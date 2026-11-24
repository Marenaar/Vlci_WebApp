const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const DAYS = ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
const when = m => new Date(m.date + 'T' + m.time + ':00');
const fmt = m => { const d = when(m); return `${DAYS[d.getDay()]} ${d.getDate()}. ${d.getMonth()+1}. ${d.getFullYear()} · <b>${m.time}</b>`; };
const inDays = m => { const a = new Date(); a.setHours(0,0,0,0); const b = when(m); b.setHours(0,0,0,0); return Math.round((b - a) / 864e5); };
const cz = n => n === 0 ? 'dnes' : n === 1 ? 'zítra' : `za ${n} ${n < 5 ? 'dny' : 'dní'}`;
const maps = m => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((m.place.name.split(',')[0] + ' ' + (m.place.address || m.place.name.split(',')[1] || '')).trim());

function place(m) {
  const label = esc(m.place.name) + (m.place.address ? ', ' + esc(m.place.address) : '');
  return `<a href="${maps(m)}" target="_blank" rel="noopener">${label}</a>`;
}

function render(d) {
  const me = d.team.id;
  const upcoming = d.next_matches.filter(m => inDays(m) >= 0);
  const [next, ...rest] = upcoming;

  $('#next').innerHTML = next ? (() => {
    const home = next.home.id === me, opp = home ? next.away : next.home;
    return `<div class="top"><span class="lab">Příští zápas · ${next.round}. kolo</span>
      <span class="chip ${home ? 'on' : ''}">${home ? 'DOMA' : 'VENKU'}</span></div>
      <h2 class="h vs">${esc(d.team.name)}<small>proti</small>${esc(opp.name)}</h2>
      <div>${fmt(next)}<br><span class="dim">${place(next)}</span></div>
      <p class="lab">${cz(inDays(next))}</p>`;
  })() : '<p class="dim">Žádný další zápas v rozpisu.</p>';

  $('#table').innerHTML = `<div class="top"><h2 class="h">Tabulka</h2>
    <span class="dim">${d.source_sync ? 'sipky.org · ' + esc(d.source_sync) : ''}</span></div>
    <div class="t hd"><span>#</span><span>Družstvo</span><span>Z</span><span>Skóre</span><span>B</span></div>` +
    d.standings.map(s => `<div class="t ${s.id === me ? 'me' : ''}"><span>${s.rank}</span><span>${esc(s.name)}</span>
      <span>${s.played}</span><span>${s.score[0]}:${s.score[1]}</span><span>${s.points}</span></div>`).join('');

  $('#more').innerHTML = rest.length ? '<h2 class="h">Další zápasy</h2>' + rest.slice(0, 6).map(m => {
    const home = m.home.id === me, opp = home ? m.away : m.home, dt = when(m);
    return `<div class="m"><div><b>${DAYS[dt.getDay()].slice(0,2)} ${dt.getDate()}. ${dt.getMonth()+1}. · ${m.time}</b><br>
      <small>${esc(d.team.name)} – ${esc(opp.name)}<br>${esc(m.place.name)}</small></div>
      <span class="chip ${home ? 'on' : ''}">${home ? 'DOMA' : 'VENKU'}</span></div>`;
  }).join('') : '';
  if (!rest.length) $('#more').hidden = true;

  $('#foot').innerHTML = `Data: <a href="${esc(d.source_url)}" target="_blank" rel="noopener">sipky.org (UŠO)</a>, obnovují se automaticky každé 3 hodiny.`;
}

fetch('data.json', { cache: 'no-cache' })
  .then(r => r.json()).then(render)
  .catch(() => { $('#next').innerHTML = '<p class="dim">Data se nepodařilo načíst.</p>'; });
