-- Pronto POS: link an owner's telephone to the same Supabase Auth email identity.
-- The mapping is private; passwords are ALWAYS verified by GoTrue, never SQL.
create or replace function pronto_private.normalize_mz_mobile(p_phone text)
returns text language plpgsql immutable set search_path='' as $$
declare d text := pg_catalog.regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
 if d ~ '^0?8[2-7][0-9]{7}$' then return '+258'||pg_catalog.right(d,9); end if;
 if d ~ '^2588[2-7][0-9]{7}$' then return '+'||d; end if;
 return null;
end;$$;
revoke all on function pronto_private.normalize_mz_mobile(text) from public,anon,authenticated;

create table if not exists pronto_private.phone_login_aliases(
 user_id uuid primary key references auth.users(id) on delete cascade,
 phone_e164 text not null unique check(phone_e164 ~ '^\+2588[2-7][0-9]{7}$'),
 created_at timestamptz not null default now()
);
revoke all on pronto_private.phone_login_aliases from public,anon,authenticated;
alter table pronto_private.phone_login_aliases enable row level security;

create or replace function pronto_private.enrol_trial_phone()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_phone text;
begin
 select pronto_private.normalize_mz_mobile(b.phone) into v_phone
 from public.pronto_businesses b where b.id=new.business_id;
 if v_phone is null then
  raise exception 'invalid_phone' using errcode='22023';
 end if;
 begin
  insert into pronto_private.phone_login_aliases(user_id,phone_e164)
  values(new.user_id,v_phone);
 exception when unique_violation then
  raise exception 'phone_already_registered' using errcode='23505';
 end;
 return new;
end;$$;
revoke all on function pronto_private.enrol_trial_phone() from public,anon,authenticated;
drop trigger if exists pronto_register_phone_alias on pronto_private.self_service_trials;
create trigger pronto_register_phone_alias after insert on pronto_private.self_service_trials
for each row execute function pronto_private.enrol_trial_phone();

-- Backfill only the self-service trials; never infer an owner's phone from employees.
insert into pronto_private.phone_login_aliases(user_id,phone_e164)
select t.user_id,pronto_private.normalize_mz_mobile(b.phone)
from pronto_private.self_service_trials t
join public.pronto_businesses b on b.id=t.business_id
where pronto_private.normalize_mz_mobile(b.phone) is not null
on conflict do nothing;

create table if not exists pronto_private.phone_login_limits(
 phone_e164 text primary key,
 window_started_at timestamptz not null default now(),
 attempts integer not null default 0 check(attempts>=0)
);
revoke all on pronto_private.phone_login_limits from public,anon,authenticated;
alter table pronto_private.phone_login_limits enable row level security;

-- This RPC returns the email ONLY to the service-role Edge Function.
-- Limit attempts per telephone before calling GoTrue. No public enumeration endpoint.
create or replace function public.pronto_login_email_for_phone(p_phone text)
returns text language plpgsql security definer volatile set search_path='' as $$
declare v_phone text;v_attempts integer;v_email text;
begin
 v_phone:=pronto_private.normalize_mz_mobile(p_phone);
 if v_phone is null then return null; end if;
 insert into pronto_private.phone_login_limits(phone_e164,window_started_at,attempts)
 values(v_phone,now(),1)
 on conflict(phone_e164) do update set
  attempts=case when pronto_private.phone_login_limits.window_started_at<now()-interval '15 minutes'
   then 1 else pronto_private.phone_login_limits.attempts+1 end,
  window_started_at=case when pronto_private.phone_login_limits.window_started_at<now()-interval '15 minutes'
   then now() else pronto_private.phone_login_limits.window_started_at end
 returning attempts into v_attempts;
 if v_attempts>10 then raise exception 'too_many_attempts' using errcode='P0001';end if;
 select u.email into v_email from pronto_private.phone_login_aliases a
 join auth.users u on u.id=a.user_id
 where a.phone_e164=v_phone;
 return v_email;
end;$$;
revoke all on function public.pronto_login_email_for_phone(text) from public,anon,authenticated;
grant execute on function public.pronto_login_email_for_phone(text) to service_role;
