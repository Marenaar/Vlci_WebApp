(() => {
  const C = window.VLCI || {};
  const configured = () => !!(C.supabaseUrl && C.supabaseKey);
  const boxes = { att: document.getElementById('attendance'), prof: document.getElementById('profile'), stats: document.getElementById('stats') };
  const E = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const dn = p => p.nickname || p.name;                 // zobrazované jméno: přezdívka, jinak jméno
  const MSG = {
    bad_login: 'Špatný PIN.', locked: 'Příliš mnoho pokusů, zkus to za 15 minut.',
    bad_old: 'Starý PIN nesedí.', same_pin: 'Nový PIN musí být jiný než starý.',
    bad_pin_format: 'PIN musí mít přesně 6 číslic.', forbidden: 'Na tohle nemáš oprávnění.',
    taken: 'Občerstvení už má někdo jiný.', self: 'Sám sobě tohle změnit nejde.', bad_nick: 'Přezdívka může mít nejvýše 24 znaků.'
  };
  const HEAD = { att: '<h2 class="h">Docházka a občerstvení</h2>', prof: '<h2 class="h">Profil</h2>', stats: '<h2 class="h">Statistiky docházky</h2>' };
  let S = JSON.parse(localStorage.getItem('vlci_session') || 'null');
  let data, next, ov, adm, reveal = null, view = 'main', note = { box: '', text: '' };
  let tab = (location.hash || '#zapas').slice(1);

  const save = () => localStorage.setItem('vlci_session', JSON.stringify(S));
  const show = (box, html) => { boxes[box].innerHTML = html; };
  const say = (box, text) => { note = { box, text }; };
  const noteHtml = box => note.box === box && note.text ? `<p class="err" role="alert">${E(note.text)}</p>` : '';
  const fail = (box, e) => say(box, MSG[e.message] || 'Chyba: ' + e.message);
  const loginLink = (txt, btn) => `<p class="dim">${txt}</p><a class="b" href="#profil">${btn}</a>`;

  async function rpc(fn, args = {}) {
    const r = await fetch(C.supabaseUrl + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: { apikey: C.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify(args)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'error');
    return j;
  }

  async function authFail(e, box) {
    if (e.message === 'not_logged_in') {
      S = null; localStorage.removeItem('vlci_session');
      say('prof', 'Přihlášení vypršelo, přihlas se znovu.');
      return renderAll();
    }
    fail(box, e);
    show(box, HEAD[box] + noteHtml(box) + '<button class="b" data-act="retry">Zkusit znovu</button>');
  }

  function renderAll() { renderAtt(); renderProf(); if (tab === 'statistiky') renderStats(); }

  /* ---------- karta Zápas: docházka a občerstvení ---------- */
  async function renderAtt() {
    if (!configured()) return;                                   // zůstane text „Připravujeme"
    if (!next) return show('att', HEAD.att + '<p class="dim">Zatím není vypsaný další zápas.</p>');
    if (!S) return show('att', HEAD.att + loginLink('Pro potvrzení účasti se přihlas.', 'Přihlásit se'));
    if (S.must_change) return show('att', HEAD.att + loginLink('Nejdřív si změň úvodní PIN.', 'Změnit PIN'));
    try { ov = await rpc('overview', { p_token: S.token }); attView(); } catch (e) { await authFail(e, 'att'); }
  }

  function attView() {
    const me = ov.me, key = next.date, home = next.home.id === data.team.id;
    const att = Object.fromEntries(ov.attendance.filter(a => a.match === key).map(a => [a.player, a.status]));
    const cnt = s => ov.players.filter(p => att[p.id] === s).length;
    const wait = ov.players.length - cnt('yes') - cnt('no') - cnt('maybe');
    const rows = ov.players.map(p => {
      const st = att[p.id], mine = p.id === me.id;
      const lab = mine ? { yes: 'Hraju', no: 'Nehraju', maybe: 'Nevím' } : { yes: 'Hraje', no: 'Ne', maybe: '?' };
      const ctl = (mine || me.is_admin)
        ? `<div class="seg">${['yes', 'no', 'maybe'].map(s => `<button data-att="${s}" data-p="${p.id}" class="${st === s ? 'act' : ''}" aria-pressed="${st === s}">${lab[s]}</button>`).join('')}</div>`
        : `<span class="chip ${st === 'yes' ? 'on' : st === 'no' ? 'off' : 'wait'}">${st === 'yes' ? 'Hraje' : st === 'no' ? 'Nehraje' : st === 'maybe' ? 'Možná' : 'Čeká'}</span>`;
      return `<div class="pr ${mine ? 'mine' : ''}"><span title="${E(p.name)}">${E(dn(p))}${mine ? ' (ty)' : ''}</span>${ctl}</div>`;
    }).join('');
    const c = ov.catering.find(x => x.match === key);
    const cat = home
      ? `<h3 class="h sm">Občerstvení</h3><div class="pr"><span>Zajišťuje: <b>${c ? E(c.name) : 'zatím nikdo'}</b></span>
          ${!c ? `<button class="b" data-cat="${me.id}">Beru to</button>` : c.player === me.id ? '<button class="b ghost" data-cat="">Zrušit</button>' : ''}</div>
        ${me.is_admin ? `<label class="dim">Přidělit (správce)<select data-catsel><option value="">nikdo</option>${ov.players.map(p => `<option value="${p.id}" ${c && c.player === p.id ? 'selected' : ''}>${E(dn(p))}</option>`).join('')}</select></label>` : ''}`
      : '<p class="dim">Venkovní zápas, občerstvení se neřeší.</p>';
    show('att', `${HEAD.att}<p class="dim">${next.date.split('-').reverse().map(Number).join('. ')} · ${cnt('yes')} hrají · ${cnt('no')} ne · ${cnt('maybe')} možná · ${wait} čeká</p>${noteHtml('att')}${rows}${cat}`);
  }

  /* ---------- karta Statistiky: docházka ---------- */
  async function renderStats() {
    if (!configured()) return;
    if (!S) return show('stats', HEAD.stats + loginLink('Statistiky docházky vidí přihlášení hráči.', 'Přihlásit se'));
    if (S.must_change) return show('stats', HEAD.stats + loginLink('Nejdřív si změň úvodní PIN.', 'Změnit PIN'));
    try {
      const r = await rpc('attendance_stats', { p_token: S.token }), m = r.matches;
      if (!m) return show('stats', HEAD.stats + '<p class="dim">Statistiky se začnou počítat po prvním odehraném zápase, u kterého se vyplňovala docházka.</p>');
      const list = r.players.map(p => ({ ...p, none: m - p.yes - p.no - p.maybe, pct: Math.round(100 * p.yes / m) })).sort((a, b) => b.pct - a.pct || dn(a).localeCompare(dn(b), 'cs'));
      show('stats', `${HEAD.stats}<p class="dim">Podle potvrzené účasti u ${m} odehraných zápasů s evidencí docházky. Nejde o skutečně odehrané zápasy, ty přijdou později.</p>` +
        list.map(p => `<div class="st"><div class="top"><b>${E(dn(p))}</b><span>${p.yes}/${m} · ${p.pct} %</span></div>
          <div class="bar" role="img" aria-label="${p.pct} %"><i style="width:${p.pct}%"></i></div>
          <small class="dim">ne ${p.no} · možná ${p.maybe} · bez odpovědi ${p.none}</small></div>`).join(''));
    } catch (e) { await authFail(e, 'stats'); }
  }

  /* ---------- karta Profil: přihlášení, přezdívka, PIN, správa ---------- */
  async function renderProf() {
    if (!configured()) return;
    try {
      if (!S) return await loginView();
      if (S.must_change || view === 'pin') return pinView();
      if (view === 'admin') { adm = await rpc('admin_players', { p_token: S.token }); return adminView(); }
      profileView();
    } catch (e) { await authFail(e, 'prof'); }
  }

  async function loginView() {
    const list = await rpc('player_list'), last = localStorage.getItem('vlci_last');
    show('prof', `${HEAD.prof}<p class="dim">Přihlas se svým jménem a PINem.</p>${noteHtml('prof')}
      <form id="f-login"><label>Jméno<select name="player" required>${list.map(p => `<option value="${p.id}" ${String(p.id) === last ? 'selected' : ''}>${E(p.nickname ? `${p.nickname} (${p.name})` : p.name)}</option>`).join('')}</select></label>
      <label>PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" required></label>
      <button class="b">Přihlásit</button></form>`);
  }

  function profileView() {
    show('prof', `${HEAD.prof}<p><b>${E(S.name)}</b> ${S.is_admin ? '<span class="chip on">správce</span>' : ''}</p>${noteHtml('prof')}
      <form id="f-nick"><label>Přezdívka (zobrazuje se v docházce)<input name="nick" maxlength="24" value="${E(S.nickname || '')}" placeholder="např. Vlk"></label>
      <button class="b">Uložit přezdívku</button></form>
      <p class="dim">Jméno jako na soupisce mění správce.</p>
      <div class="seg"><button class="b ghost" data-v="pin">Změnit PIN</button>${S.is_admin ? '<button class="b ghost" data-v="admin">Správa týmu</button>' : ''}<button class="b ghost" data-v="out">Odhlásit</button></div>`);
  }

  function pinView() {
    const forced = S.must_change, f = (n, l, ac) => `<label>${l}<input name="${n}" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="${ac}" required></label>`;
    show('prof', `${HEAD.prof}<h3 class="h sm">Změna PINu</h3><p class="dim">${forced ? 'Při prvním přihlášení si musíš zvolit vlastní 6místný PIN.' : 'Zvol nový 6místný PIN.'}</p>${noteHtml('prof')}
      <form id="f-pin">${f('old', 'Dosavadní PIN', 'current-password')}${f('n1', 'Nový PIN', 'new-password')}${f('n2', 'Nový PIN znovu', 'new-password')}
      <button class="b">Uložit PIN</button>${forced ? '' : '<button type="button" class="b ghost" data-v="back">Zpět</button>'}</form>`);
  }

  function adminView() {
    const r = reveal ? `<div class="rev"><p>PIN pro <b>${E(reveal.name)}</b>: <b class="pin">${E(reveal.pin)}</b></p>
      <button class="b" data-adm="copy">Zkopírovat zprávu</button><p class="dim">Zobrazuje se jen teď. Hráč si ho po prvním přihlášení změní.</p></div>` : '';
    const rows = adm.map(x => `<div class="pr col"><span>${E(x.name)}${x.nickname ? ` „${E(x.nickname)}“` : ''} <small class="dim">${[x.is_admin ? 'správce' : '', x.plays ? '' : 'nehraje', x.active ? '' : 'vyřazen', x.must_change ? 'čeká na změnu PINu' : ''].filter(Boolean).join(' · ')}</small></span>
      <div class="seg"><button data-adm="pin" data-id="${x.id}">Nový PIN</button><button data-adm="rename" data-id="${x.id}">Přejmenovat</button>
      <button data-adm="active" data-id="${x.id}">Aktivní: ${x.active ? 'ano' : 'ne'}</button><button data-adm="plays" data-id="${x.id}">Hráč: ${x.plays ? 'ano' : 'ne'}</button>
      <button data-adm="admin" data-id="${x.id}">Správce: ${x.is_admin ? 'ano' : 'ne'}</button></div></div>`).join('');
    show('prof', `<div class="top"><h2 class="h">Správa týmu</h2><button class="lnk" data-v="back">Zpět</button></div>${noteHtml('prof')}${r}${rows}
      <form id="f-add"><label>Nový hráč<input name="name" maxlength="60" placeholder="Jméno a příjmení" required></label>
      <label class="chk"><input type="checkbox" name="plays" checked> hraje v zápasech</label><button class="b">Přidat a vygenerovat PIN</button></form>`);
  }

  const mk = (name, pin) => ({ name, pin, text: `Ahoj ${name}, tvůj PIN do appky Vlků je ${pin}. Otevři ${location.origin}${location.pathname}, v nabídce Profil vyber své jméno, přihlas se a PIN si změň.` });

  async function adminAction(b) {
    const a = b.dataset.adm, id = +b.dataset.id, pl = adm.find(x => x.id === id);
    if (a === 'copy') { await navigator.clipboard.writeText(reveal.text); say('prof', 'Zpráva zkopírována, stačí ji vložit do WhatsAppu nebo SMS.'); return; }
    if (a === 'pin') { const r = await rpc('admin_reset_pin', { p_token: S.token, p_player: id }); reveal = mk(pl.name, r.pin); return; }
    const patch = a === 'rename' ? { p_name: prompt('Nové jméno', pl.name) || pl.name } : a === 'active' ? { p_active: !pl.active } : a === 'plays' ? { p_plays: !pl.plays } : { p_is_admin: !pl.is_admin };
    await rpc('admin_update_player', { p_token: S.token, p_player: id, p_name: pl.name, p_active: pl.active, p_is_admin: pl.is_admin, p_plays: pl.plays, ...patch });
  }

  /* ---------- události ---------- */
  const main = document.querySelector('main');

  main.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b || (b.closest('form') && b.getAttribute('type') !== 'button')) return;   // odeslání formulářů řeší událost submit
    const box = b.closest('#attendance') ? 'att' : b.closest('#profile') ? 'prof' : b.closest('#stats') ? 'stats' : null;
    if (!box) return;
    note = { box: '', text: '' };
    if (!b.dataset.adm) reveal = null;
    try {
      if (b.dataset.att) await rpc('set_attendance', { p_token: S.token, p_match: next.date, p_status: b.dataset.att, p_player: +b.dataset.p });
      else if ('cat' in b.dataset) await rpc('set_catering', { p_token: S.token, p_match: next.date, p_player: b.dataset.cat ? +b.dataset.cat : null });
      else if (b.dataset.v === 'out') { S = null; view = 'main'; localStorage.removeItem('vlci_session'); }
      else if (b.dataset.v) view = b.dataset.v === 'back' ? 'main' : b.dataset.v;
      else if (b.dataset.adm) await adminAction(b);
    } catch (err) { fail(box, err); }
    if (b.dataset.v === 'out') renderAll();
    else if (box === 'att') renderAtt();
    else if (box === 'stats') renderStats();
    else { renderProf(); if (b.dataset.adm) renderAtt(); }
  });

  main.addEventListener('change', async e => {
    if (!e.target.matches('[data-catsel]')) return;
    note = { box: '', text: '' };
    try { await rpc('set_catering', { p_token: S.token, p_match: next.date, p_player: e.target.value ? +e.target.value : null }); } catch (err) { fail('att', err); }
    renderAtt();
  });

  main.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value;
    note = { box: '', text: '' };
    let go = null;
    try {
      if (f.id === 'f-login') {
        localStorage.setItem('vlci_last', v('player'));
        const r = await rpc('login', { p_player: +v('player'), p_pin: v('pin') });
        if (r.error) say('prof', MSG[r.error]); else { S = r; view = 'main'; save(); if (!S.must_change) go = '#zapas'; }
      } else if (f.id === 'f-pin') {
        if (v('n1') !== v('n2')) say('prof', 'Nové PINy se neshodují.');
        else { const forced = S.must_change; await rpc('change_pin', { p_token: S.token, p_old: v('old'), p_new: v('n1') }); S.must_change = false; view = 'main'; save(); if (forced) go = '#zapas'; }
      } else if (f.id === 'f-nick') {
        const nick = v('nick').trim();
        await rpc('set_nickname', { p_token: S.token, p_nick: nick });
        S.nickname = nick; save(); say('prof', nick ? 'Přezdívka uložena.' : 'Přezdívka odstraněna.');
      } else if (f.id === 'f-add') {
        const r = await rpc('admin_add_player', { p_token: S.token, p_name: v('name'), p_plays: f.elements.plays.checked });
        reveal = mk(v('name').trim(), r.pin);
      }
    } catch (err) { fail('prof', err); }
    renderAll();
    if (go) location.hash = go;
  });

  document.addEventListener('vlci-tab', e => { tab = e.detail; if (tab === 'statistiky' && data) renderStats(); });

  function init() {
    data = window.VLCI_DATA;
    const today = new Date().toLocaleDateString('sv-SE');
    next = (data.next_matches || []).find(m => m.date >= today);
    if (configured()) renderAll();
  }
  if (window.VLCI_DATA) init(); else document.addEventListener('vlci-data', init);
})();
