-- VLCI: databáze, zabezpečené funkce a úvodní hráči.
-- Spusť CELÉ najednou: Supabase → SQL Editor → New query → vložit → Run.
-- Na konci se zobrazí tabulka s úvodními PINy. Zobrazí se JEN JEDNOU, ulož si je.

create extension if not exists pgcrypto with schema extensions;

create table if not exists players (
  id serial primary key,
  name text not null,
  pin_hash text not null,
  must_change boolean not null default true,
  is_admin boolean not null default false,   -- správce (kapitán i admin)
  plays boolean not null default true,       -- zobrazuje se v docházce
  active boolean not null default true,
  failed int not null default 0,
  locked_until timestamptz
);
alter table players add column if not exists nickname text;   -- přezdívka (volitelná)
create table if not exists sessions (
  token uuid primary key default gen_random_uuid(),
  player_id int not null references players(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '90 days'
);
create table if not exists attendance (
  match_key text not null,                   -- datum zápasu YYYY-MM-DD
  player_id int not null references players(id) on delete cascade,
  status text not null check (status in ('yes','no','maybe')),
  updated_at timestamptz not null default now(),
  primary key (match_key, player_id)
);
create table if not exists catering (
  match_key text primary key,
  player_id int not null references players(id) on delete cascade,
  note text
);

-- Řádková bezpečnost zapnutá a ŽÁDNÉ politiky: z webu nejde číst ani zapisovat přímo do tabulek.
alter table players enable row level security;
alter table sessions enable row level security;
alter table attendance enable row level security;
alter table catering enable row level security;

-- ---------- pomocné funkce (z webu nedostupné) ----------
create or replace function _gen_pin() returns text language sql volatile
set search_path = public, extensions as $$
  select lpad((abs((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint)) % 1000000)::text, 6, '0')
$$;

create or replace function _auth(p_token uuid, p_allow_change boolean default false)
returns players language plpgsql security definer set search_path = public, extensions as $$
declare p players;
begin
  select pl.* into p from sessions s join players pl on pl.id = s.player_id
   where s.token = p_token and s.expires_at > now() and pl.active;
  if not found then raise exception 'not_logged_in'; end if;
  if p.must_change and not p_allow_change then raise exception 'must_change'; end if;
  return p;
end $$;

revoke all on function _gen_pin() from public, anon, authenticated;
revoke all on function _auth(uuid, boolean) from public, anon, authenticated;

-- ---------- přihlášení ----------
create or replace function player_list() returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'name', name, 'nickname', nickname) order by name), '[]'::json)
  from players where active
$$;

-- Chyby se vracejí jako JSON (ne výjimkou), aby se počítadlo špatných pokusů neodrolovalo.
create or replace function login(p_player int, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p players; t uuid;
begin
  select * into p from players where id = p_player and active;
  if not found then return json_build_object('error', 'bad_login'); end if;
  if p.locked_until is not null and p.locked_until > now() then
    return json_build_object('error', 'locked');
  end if;
  if p.pin_hash <> crypt(p_pin, p.pin_hash) then
    update players set
      locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' end,
      failed = case when failed + 1 >= 5 then 0 else failed + 1 end
    where id = p.id;
    return json_build_object('error', 'bad_login');
  end if;
  update players set failed = 0, locked_until = null where id = p.id;
  delete from sessions where player_id = p.id and expires_at < now();
  insert into sessions(player_id) values (p.id) returning token into t;
  return json_build_object('token', t, 'player_id', p.id, 'name', p.name, 'nickname', p.nickname,
                           'is_admin', p.is_admin, 'must_change', p.must_change);
end $$;

create or replace function change_pin(p_token uuid, p_old text, p_new text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p players;
begin
  p := _auth(p_token, true);
  if p_new !~ '^[0-9]{6}$' then raise exception 'bad_pin_format'; end if;
  if p_new = p_old then raise exception 'same_pin'; end if;
  if p.pin_hash <> crypt(p_old, p.pin_hash) then raise exception 'bad_old'; end if;
  update players set pin_hash = crypt(p_new, gen_salt('bf')), must_change = false where id = p.id;
  return json_build_object('ok', true);
end $$;

-- ---------- data pro přihlášené ----------
create or replace function overview(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p players;
begin
  p := _auth(p_token);
  return json_build_object(
    'me', json_build_object('id', p.id, 'name', p.name, 'nickname', p.nickname, 'is_admin', p.is_admin),
    'players', (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'nickname', nickname) order by name), '[]'::json)
                from players where active and plays),
    'attendance', (select coalesce(json_agg(json_build_object('match', match_key, 'player', player_id, 'status', status)), '[]'::json)
                   from attendance where match_key >= to_char(current_date - 30, 'YYYY-MM-DD')),
    'catering', (select coalesce(json_agg(json_build_object('match', c.match_key, 'player', c.player_id, 'name', coalesce(nullif(pl.nickname, ''), pl.name))), '[]'::json)
                 from catering c join players pl on pl.id = c.player_id
                 where c.match_key >= to_char(current_date - 30, 'YYYY-MM-DD')));
end $$;

create or replace function set_attendance(p_token uuid, p_match text, p_status text, p_player int default null) returns json
language plpgsql security definer set search_path = public as $$
declare p players; target int;
begin
  p := _auth(p_token);
  if p_match !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad_match'; end if;
  target := coalesce(p_player, p.id);
  if target <> p.id and not p.is_admin then raise exception 'forbidden'; end if;
  if p_status is null then
    delete from attendance where match_key = p_match and player_id = target;
  else
    insert into attendance(match_key, player_id, status) values (p_match, target, p_status)
    on conflict (match_key, player_id) do update set status = excluded.status, updated_at = now();
  end if;
  return json_build_object('ok', true);
end $$;

-- p_player = null → zrušit. Hráč smí převzít jen volné občerstvení a zrušit jen své; správce smí vše.
create or replace function set_catering(p_token uuid, p_match text, p_player int default null, p_note text default null) returns json
language plpgsql security definer set search_path = public as $$
declare p players; cur int;
begin
  p := _auth(p_token);
  if p_match !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad_match'; end if;
  select player_id into cur from catering where match_key = p_match;
  if not p.is_admin then
    if p_player is not null and p_player <> p.id then raise exception 'forbidden'; end if;
    if cur is not null and cur <> p.id then raise exception 'taken'; end if;
  end if;
  if p_player is null then
    delete from catering where match_key = p_match;
  else
    insert into catering(match_key, player_id, note) values (p_match, p_player, p_note)
    on conflict (match_key) do update set player_id = excluded.player_id, note = excluded.note;
  end if;
  return json_build_object('ok', true);
end $$;

-- ---------- správa (kapitán i admin) ----------
create or replace function admin_players(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p players;
begin
  p := _auth(p_token);
  if not p.is_admin then raise exception 'forbidden'; end if;
  return (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'nickname', nickname, 'active', active,
            'is_admin', is_admin, 'plays', plays, 'must_change', must_change) order by name), '[]'::json) from players);
end $$;

create or replace function admin_add_player(p_token uuid, p_name text, p_plays boolean default true) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p players; pin text; nid int;
begin
  p := _auth(p_token);
  if not p.is_admin then raise exception 'forbidden'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'bad_name'; end if;
  pin := _gen_pin();
  insert into players(name, pin_hash, plays) values (trim(p_name), crypt(pin, gen_salt('bf')), p_plays) returning id into nid;
  return json_build_object('id', nid, 'pin', pin);
end $$;

create or replace function admin_reset_pin(p_token uuid, p_player int) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p players; pin text;
begin
  p := _auth(p_token);
  if not p.is_admin then raise exception 'forbidden'; end if;
  pin := _gen_pin();
  update players set pin_hash = crypt(pin, gen_salt('bf')), must_change = true, failed = 0, locked_until = null
   where id = p_player;
  delete from sessions where player_id = p_player;
  return json_build_object('pin', pin);
end $$;

create or replace function admin_update_player(p_token uuid, p_player int, p_name text, p_active boolean, p_is_admin boolean, p_plays boolean) returns json
language plpgsql security definer set search_path = public as $$
declare p players;
begin
  p := _auth(p_token);
  if not p.is_admin then raise exception 'forbidden'; end if;
  if p_player = p.id and (not p_active or not p_is_admin) then raise exception 'self'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'bad_name'; end if;
  update players set name = trim(p_name), active = p_active, is_admin = p_is_admin, plays = p_plays where id = p_player;
  if not p_active then delete from sessions where player_id = p_player; end if;
  return json_build_object('ok', true);
end $$;

grant execute on function player_list(), login(int, text), change_pin(uuid, text, text), overview(uuid),
  set_attendance(uuid, text, text, int), set_catering(uuid, text, int, text), admin_players(uuid),
  admin_add_player(uuid, text, boolean), admin_reset_pin(uuid, int),
  admin_update_player(uuid, int, text, boolean, boolean, boolean) to anon;

-- ---------- přezdívka a statistiky docházky ----------
create or replace function set_nickname(p_token uuid, p_nick text) returns json
language plpgsql security definer set search_path = public as $$
declare p players; n text;
begin
  p := _auth(p_token);
  n := nullif(trim(coalesce(p_nick, '')), '');
  if n is not null and length(n) > 24 then raise exception 'bad_nick'; end if;
  update players set nickname = n where id = p.id;
  return json_build_object('ok', true);
end $$;

-- Počítá potvrzenou účast u odehraných zápasů (datum před dneškem), u kterých někdo vyplnil docházku.
create or replace function attendance_stats(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p players; m int; today text := to_char(current_date, 'YYYY-MM-DD');
begin
  p := _auth(p_token);
  select count(distinct match_key) into m from attendance where match_key < today;
  return json_build_object('matches', m, 'players', (
    select coalesce(json_agg(row_to_json(s) order by s.name), '[]'::json) from (
      select pl.id, pl.name, pl.nickname,
             count(a.status) filter (where a.status = 'yes') as yes,
             count(a.status) filter (where a.status = 'no') as no,
             count(a.status) filter (where a.status = 'maybe') as maybe
      from players pl left join attendance a on a.player_id = pl.id and a.match_key < today
      where pl.active and pl.plays group by pl.id) s));
end $$;

grant execute on function set_nickname(uuid, text), attendance_stats(uuid) to anon;

-- ---------- úvodní hráči (soupiska ze sipky.org) + účet správce ----------
-- Spustí se jen na prázdné tabulce. Úvodní PINy se vypíšou jako výsledek tohoto dotazu.
with names(n, adm, pl) as (
  select * from (values
    ('Jan Dymacek', false, true), ('David Elbl', false, true), ('Petr Hanák', false, true),
    ('Miroslava Kiliánová', false, true), ('Kateřina Kozlová', false, true),
    ('Vendula Libánková', false, true), ('Martin Procházka', false, true),
    ('Jiří Rybáček', true, true),            -- kapitán = správce
    ('Roman Šandera', false, true), ('Martin Šmerda', false, true),
    ('Správce appky', true, false)           -- technický admin, v docházce se nezobrazuje
  ) v(n, adm, pl)
  where not exists (select 1 from players)
),
pins as (select n, adm, pl, _gen_pin() as pin from names),
ins as (
  insert into players(name, pin_hash, is_admin, plays)
  select n, extensions.crypt(pin, extensions.gen_salt('bf')), adm, pl from pins
  returning id
)
select n as jmeno, pin as uvodni_pin, case when adm then 'správce' else 'hráč' end as role
from pins order by adm desc, n;
