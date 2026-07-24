begin;

create table if not exists public.compteurs_journaliers (
  type text not null,
  jour date not null,
  valeur bigint not null default 0 check (valeur >= 0),
  primary key (type, jour)
);

alter table public.compteurs_journaliers enable row level security;
revoke all on table public.compteurs_journaliers from anon, authenticated;

create or replace function public.generer_id(
  p_entreprise uuid,
  p_type text,
  p_prefixe text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jour date := (clock_timestamp() at time zone 'Africa/Abidjan')::date;
  v_valeur bigint;
  v_prefixe text;
  v_suffixe text;
begin
  v_prefixe := case p_type
    when 'ramassage' then 'RM'
    when 'commande' then 'CMD'
    when 'colis' then 'COL'
    when 'lot' then 'LIV'
    else upper(trim(p_prefixe))
  end;

  if v_prefixe is null or v_prefixe = '' then
    raise exception 'Prefixe d''identifiant manquant pour le type %.', p_type;
  end if;

  insert into public.compteurs_journaliers (type, jour, valeur)
  values (p_type, v_jour, 1)
  on conflict (type, jour) do update
    set valeur = public.compteurs_journaliers.valeur + 1
  returning valeur into v_valeur;

  v_suffixe := case
    when v_valeur < 1000 then lpad(v_valeur::text, 3, '0')
    else v_valeur::text
  end;

  return v_prefixe || '-' || to_char(v_jour, 'YYMMDD') || '-' || v_suffixe;
end;
$$;

revoke all on function public.generer_id(uuid, text, text) from public;
grant execute on function public.generer_id(uuid, text, text) to authenticated;

alter table public.commandes
  add column if not exists id_ramassage text;

create unique index if not exists uq_commandes_id_ramassage
  on public.commandes(id_ramassage)
  where id_ramassage is not null;

do $$
declare
  v_commande record;
  v_jour date;
  v_valeur bigint;
  v_suffixe text;
begin
  for v_commande in
    select id_commande, cree_le
    from public.commandes
    where id_ramassage is null
    order by cree_le, id_commande
  loop
    v_jour := (v_commande.cree_le at time zone 'Africa/Abidjan')::date;

    insert into public.compteurs_journaliers (type, jour, valeur)
    values ('ramassage', v_jour, 1)
    on conflict (type, jour) do update
      set valeur = public.compteurs_journaliers.valeur + 1
    returning valeur into v_valeur;

    v_suffixe := case
      when v_valeur < 1000 then lpad(v_valeur::text, 3, '0')
      else v_valeur::text
    end;

    update public.commandes
    set id_ramassage = 'RM-' || to_char(v_jour, 'YYMMDD') || '-' || v_suffixe
    where id_commande = v_commande.id_commande;
  end loop;
end;
$$;

create or replace function public.attribuer_id_ramassage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id_ramassage is null or btrim(new.id_ramassage) = '' then
    new.id_ramassage := public.generer_id(
      new.id_entreprise,
      'ramassage',
      'RM'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_commandes_id_ramassage on public.commandes;
create trigger trg_commandes_id_ramassage
before insert on public.commandes
for each row execute function public.attribuer_id_ramassage();

commit;

select 'identifiants_metier_dates_ok' as status;
