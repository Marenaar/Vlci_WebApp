(() => {
  const C = window.VLCI || {};
  const box = document.getElementById('attendance');
  const E = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const MSG = {
    bad_login: 'Špatný PIN.', locked: 'Příliš mnoho pokusů, zkus to za 15 minut.',
    bad_old: 'Starý PIN nesedí.', same_pin: 'Nový PIN musí být jiný než starý.',
    bad_pin_format: 'PIN musí mít přesně 6 číslic.', forbidden: 'Na tohle nemáš oprávnění.',
    taken: 'Občerstvení už má někdo jiný.', self: 'Sám sobě tohle změnit nejde.'
  };
  const save = () => localStorage.setItem('vlci_session', JSON.stringify(S));
  let S = JSON.parse(localStorage.getItem('vlci_session') || 'null');
  let data, next, ov, adm, reveal = null, view = 'main', msg = '';

  async function rpc(fn, args = {}) {
    const r = await fetch(C.supabaseUrl + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: { apikey: C.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify(args)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'error');
    return j;
  }
  const show = h => { box.innerHTML = h; };
  const note = () => msg ? `<p class="err" role="alert">${E(msg)}</p>` : '';
  const fail = e => { msg = MSG[e.message] || 'Chyba: ' + e.message; };

  async function render() {
    try {
      if (!S) return await loginView();
      if (S.must_change || view === 'pin') return pinView();
      if (view === 'admin') { adm = await rpc('admin_players', { p_token: S.token }); return adminView(); }
      ov = await rpc('overview', { p_token: S.token });
      return mainView();
    } catch (e) {
      if (e.message === 'not_logged_in') { S = null; localStorage.removeItem('vlci_session'); msg = 'Přihlášení vypršelo, přihlas se znovu.'; return render(); }
      fail(e); show(`<h2 class="h">Docházka a občerstvení</h2>${note()}<button class="b" data-v="back">Zkusit znovu</button>`);
    }
  }

  async function loginView() {
    const list = await rpc('player_list'), last = localStorage.getItem('vlci_last');
    show(`<h2 class="h">Docházka a občerstvení</h2><p class="dim">Přihlas se svým jménem a PINem.</p>${note()}
      <form id="f-login"><label>Jméno<select name="player" required>${list.map(p => `<option value="${p.id}" ${String(p.id) === last ? 'selected' : ''}>${E(p.name)}</option>`).join('')}</select></label>
      <label>PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" required></label>
      <button class="b">Přihlásit</button></form>`);
  }

  function pinView() {
    const forced = S.must_change;
    show(`<h2 class="h">Změna PINu</h2><p class="dim">${forced ? 'Při prvním přihlášení si musíš zvolit vlastní 6místný PIN.' : 'Zvol nový 6místný PIN.'}</p>${note()}
      <form id="f-pin"><label>Dosavadní PIN<input name="old" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" required></label>
      <label>Nový PIN<input name="n1" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
      <label>Nový PIN znovu<input name="n2" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
      <button class="b">Uložit PIN</button> ${forced ? '' : '<button type="button" class="b ghost" data-v="back">Zpět</button>'}</form>`);
  }

  function mainView() {
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
      return `<div class="pr ${mine ? 'mine' : ''}"><span>${E(p.name)}${mine ? ' (ty)' : ''}</span>${ctl}</div>`;
    }).join('');
    const c = ov.catering.find(x => x.match === key);
    const cat = home
      ? `<h3 class="h sm">Občerstvení</h3><div class="pr"><span>Zajišťuje: <b>${c ? E(c.name) : 'zatím nikdo'}</b></span>
          ${!c ? `<button class="b" data-cat="${me.id}">Beru to</button>` : c.player === me.id ? '<button class="b ghost" data-cat="">Zrušit</button>' : ''}</div>
        ${me.is_admin ? `<label class="dim">Přidělit (správce)<select data-catsel><option value="">nikdo</option>${ov.players.map(p => `<option value="${p.id}" ${c && c.player === p.id ? 'selected' : ''}>${E(p.name)}</option>`).join('')}</select></label>` : ''}`
      : '<p class="dim">Venkovní zápas, občerstvení se neřeší.</p>';
    show(`<div class="top"><h2 class="h">Kdo hraje</h2><span class="dim">${E(me.name)} · <button class="lnk" data-v="pin">PIN</button> · <button class="lnk" data-v="out">Odhlásit</button></span></div>
      <p class="dim">${next.date.split('-').reverse().map(Number).join('. ')} · ${cnt('yes')} hrají · ${cnt('no')} ne · ${cnt('maybe')} možná · ${wait} čeká</p>${note()}
      ${rows}${cat}${me.is_admin ? '<button class="b ghost" data-v="admin">Správa týmu</button>' : ''}`);
  }

  function adminView() {
    const r = reveal ? `<div class="rev"><p>PIN pro <b>${E(reveal.name)}</b>: <b class="pin">${E(reveal.pin)}</b></p>
      <button class="b" data-adm="copy">Zkopírovat zprávu</button><p class="dim">Zobrazuje se jen teď. Hráč si ho po prvním přihlášení změní.</p></div>` : '';
    const rows = adm.map(x => `<div class="pr col"><span>${E(x.name)} <small class="dim">${[x.is_admin ? 'správce' : '', x.plays ? '' : 'nehraje', x.active ? '' : 'vyřazen', x.must_change ? 'čeká na změnu PINu' : ''].filter(Boolean).join(' · ')}</small></span>
      <div class="seg" data-id="${x.id}"><button data-adm="pin" data-id="${x.id}">Nový PIN</button><button data-adm="rename" data-id="${x.id}">Přejmenovat</button>
      <button data-adm="active" data-id="${x.id}">Aktivní: ${x.active ? 'ano' : 'ne'}</button><button data-adm="plays" data-id="${x.id}">Hráč: ${x.plays ? 'ano' : 'ne'}</button>
      <button data-adm="admin" data-id="${x.id}">Správce: ${x.is_admin ? 'ano' : 'ne'}</button></div></div>`).join('');
    show(`<div class="top"><h2 class="h">Správa týmu</h2><button class="lnk" data-v="back">Zpět</button></div>${note()}${r}${rows}
      <form id="f-add"><label>Nový hráč<input name="name" maxlength="60" placeholder="Jméno a příjmení" required></label>
      <label class="chk"><input type="checkbox" name="plays" checked> hraje v zápasech</label><button class="b">Přidat a vygenerovat PIN</button></form>`);
  }

  const mk = (name, pin) => ({ name, pin, text: `Ahoj ${name}, tvůj PIN do appky Vlků je ${pin}. Otevři ${location.origin}${location.pathname}, vyber své jméno, přihlas se a PIN si změň.` });

  async function adminAction(b) {
    const a = b.dataset.adm, id = +b.dataset.id, pl = adm.find(x => x.id === id);
    if (a === 'copy') { await navigator.clipboard.writeText(reveal.text); msg = 'Zpráva zkopírována, stačí ji vložit do WhatsAppu nebo SMS.'; return; }
    if (a === 'pin') { const r = await rpc('admin_reset_pin', { p_token: S.token, p_player: id }); reveal = mk(pl.name, r.pin); return; }
    const patch = a === 'rename' ? { p_name: prompt('Nové jméno', pl.name) || pl.name } : a === 'active' ? { p_active: !pl.active } : a === 'plays' ? { p_plays: !pl.plays } : { p_is_admin: !pl.is_admin };
    await rpc('admin_update_player', { p_token: S.token, p_player: id, p_name: pl.name, p_active: pl.active, p_is_admin: pl.is_admin, p_plays: pl.plays, ...patch });
  }

  box.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b || (b.form && b.type === 'submit')) return;   // odesílací tlačítka formulářů řeší událost submit
    msg = ''; if (!b.dataset.adm) reveal = null;
    try {
      if (b.dataset.att) await rpc('set_attendance', { p_token: S.token, p_match: next.date, p_status: b.dataset.att, p_player: +b.dataset.p });
      else if ('cat' in b.dataset) await rpc('set_catering', { p_token: S.token, p_match: next.date, p_player: b.dataset.cat ? +b.dataset.cat : null });
      else if (b.dataset.v === 'out') { S = null; view = 'main'; localStorage.removeItem('vlci_session'); }
      else if (b.dataset.v) view = b.dataset.v === 'back' ? 'main' : b.dataset.v;
      else if (b.dataset.adm) await adminAction(b);
    } catch (err) { fail(err); }
    render();
  });

  box.addEventListener('change', async e => {
    if (!e.target.matches('[data-catsel]')) return;
    msg = '';
    try { await rpc('set_catering', { p_token: S.token, p_match: next.date, p_player: e.target.value ? +e.target.value : null }); } catch (err) { fail(err); }
    render();
  });

  box.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value;
    msg = '';
    try {
      if (f.id === 'f-login') {
        localStorage.setItem('vlci_last', v('player'));
        const r = await rpc('login', { p_player: +v('player'), p_pin: v('pin') });
        if (r.error) msg = MSG[r.error]; else { S = r; view = 'main'; save(); }
      } else if (f.id === 'f-pin') {
        if (v('n1') !== v('n2')) msg = 'Nové PINy se neshodují.';
        else { await rpc('change_pin', { p_token: S.token, p_old: v('old'), p_new: v('n1') }); S.must_change = false; view = 'main'; save(); }
      } else if (f.id === 'f-add') {
        const r = await rpc('admin_add_player', { p_token: S.token, p_name: v('name'), p_plays: f.elements.plays.checked });
        reveal = mk(v('name').trim(), r.pin);
      }
    } catch (err) { fail(err); }
    render();
  });

  function init() {
    if (!C.supabaseUrl || !C.supabaseKey) return;           // databáze ještě není nastavená: zůstane karta „Připravujeme"
    data = window.VLCI_DATA;
    const today = new Date().toLocaleDateString('sv-SE');
    next = (data.next_matches || []).find(m => m.date >= today);
    if (!next) { show('<h2 class="h">Docházka a občerstvení</h2><p class="dim">Zatím není vypsaný další zápas.</p>'); return; }
    render();
  }
  if (window.VLCI_DATA) init(); else document.addEventListener('vlci-data', init);
})();
