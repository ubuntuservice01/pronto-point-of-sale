-- Self-service trial onboarding. A verified Supabase identity can provision one shop.
-- Auth identities are created by Supabase Auth, never by SQL or browser service keys.
insert into public.pronto_plans(name,price_cents,duration_days,active)
select 'Teste gratuito · 10 dias',0,10,true
where not exists(select 1 from public.pronto_plans where name='Teste gratuito · 10 dias');

create table if not exists pronto_private.self_service_trials(
 user_id uuid primary key references auth.users(id) on delete restrict,
 business_id uuid not null unique references public.pronto_businesses(id) on delete restrict,
 whatsapp text not null,
 industry text not null,
 marketing_consent boolean not null default false,
 started_at timestamptz not null default now(),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
revoke all on pronto_private.self_service_trials from public,anon,authenticated;
alter table pronto_private.self_service_trials enable row level security;

create or replace function pronto_private.register_self_service_business(p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_user uuid:=(select auth.uid());
 v_email text; v_business uuid;v_branch uuid;v_plan uuid;v_exp timestamptz;
 v_name text;v_owner text;v_phone text;v_whatsapp text;v_industry text;v_address text;
begin
 if v_user is null then raise exception 'login_required' using errcode='42501';end if;
 if p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object' or pg_catalog.pg_column_size(p_data)>4096 then
  raise exception 'invalid_registration' using errcode='22023';end if;
 select email into v_email from auth.users where id=v_user and email_confirmed_at is not null;
 if v_email is null then raise exception 'verify_email_first' using errcode='42501';end if;
 v_name:=pg_catalog.btrim(p_data->>'business_name');
 v_owner:=pg_catalog.btrim(p_data->>'owner_name');
 v_phone:=pg_catalog.btrim(p_data->>'phone');
 v_whatsapp:=pg_catalog.btrim(p_data->>'whatsapp');
 v_industry:=pg_catalog.btrim(p_data->>'industry');
 v_address:=pg_catalog.btrim(p_data->>'address');
 if v_name is null or length(v_name) not between 2 and 120
 or v_owner is null or length(v_owner) not between 2 and 120
 or v_phone is null or length(v_phone) not between 7 and 30
 or v_whatsapp is null or length(v_whatsapp) not between 7 and 30
 or v_industry is null or length(v_industry) not between 2 and 60
 or length(coalesce(v_address,''))>160 then
  raise exception 'invalid_registration' using errcode='22023';end if;
 if coalesce(p_data->>'accept_terms','false')<>'true' then
  raise exception 'terms_required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pronto_trial:'||v_user::text,0));
 if exists(select 1 from pronto_private.self_service_trials where user_id=v_user)
    or exists(select 1 from public.pronto_memberships where user_id=v_user)
    or exists(select 1 from pronto_private.ubuntu_super_admins where user_id=v_user and active) then
  raise exception 'account_already_registered' using errcode='23505';end if;
 select id into v_plan from public.pronto_plans
  where name='Teste gratuito · 10 dias' and active and price_cents=0 and duration_days=10
  order by id limit 1;
 if v_plan is null then raise exception 'trial_unavailable' using errcode='P0001';end if;
 v_exp:=now()+interval '10 days';
 insert into public.pronto_businesses(name,phone,address,status)
  values(v_name,v_phone,nullif(v_address,''),'active') returning id into v_business;
 insert into public.pronto_branches(business_id,name)
  values(v_business,'Principal') returning id into v_branch;
 insert into public.pronto_profiles(user_id,display_name) values(v_user,v_owner)
  on conflict(user_id) do update set display_name=excluded.display_name,updated_at=now();
 insert into public.pronto_memberships(business_id,user_id,role,active)
  values(v_business,v_user,'owner',true);
 insert into public.pronto_subscriptions(business_id,plan_id,expires_at,cancelled)
  values(v_business,v_plan,v_exp,false);
 insert into pronto_private.self_service_trials(user_id,business_id,whatsapp,industry,marketing_consent,expires_at)
  values(v_user,v_business,v_whatsapp,v_industry,coalesce((p_data->>'marketing_consent')::boolean,false),v_exp);
 return pg_catalog.jsonb_build_object('business_id',v_business,'branch_id',v_branch,
   'expires_at',v_exp,'trial_days',10);
end;$$;
revoke all on function pronto_private.register_self_service_business(jsonb) from public,anon,authenticated;
grant execute on function pronto_private.register_self_service_business(jsonb) to authenticated;
create or replace function public.pronto_self_service_register(p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.register_self_service_business(p_data);$$;
revoke all on function public.pronto_self_service_register(jsonb) from public,anon,authenticated;
grant execute on function public.pronto_self_service_register(jsonb) to authenticated;

-- Administrative funnel available to the existing audited Ubuntu admin identity.
create or replace function pronto_private.self_service_trial_overview()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
 if not pronto_private.is_ubuntu_super_admin() then
  raise exception 'admin_required' using errcode='42501';end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'business_id',t.business_id,'name',b.name,'owner_name',p.display_name,
  'email',u.email,'phone',b.phone,'whatsapp',t.whatsapp,'industry',t.industry,
  'marketing_consent',t.marketing_consent,'started_at',t.started_at,
  'trial_expires_at',t.expires_at,'license_expires_at',s.expires_at,
  'plan_name',pl.name,'status',case
   when s.cancelled or s.expires_at<=now() then 'expired'
   when s.plan_id<>pl0.id then 'converted' else 'trial' end
 ) order by t.started_at desc),'[]'::jsonb) into v_result
 from pronto_private.self_service_trials t
 join public.pronto_businesses b on b.id=t.business_id
 join auth.users u on u.id=t.user_id
 left join public.pronto_profiles p on p.user_id=t.user_id
 join public.pronto_subscriptions s on s.business_id=t.business_id
 join public.pronto_plans pl on pl.id=s.plan_id
 join public.pronto_plans pl0 on pl0.id=(select id from public.pronto_plans z where z.name='Teste gratuito · 10 dias' order by id limit 1);
 return v_result;
end;$$;
revoke all on function pronto_private.self_service_trial_overview() from public,anon,authenticated;
grant execute on function pronto_private.self_service_trial_overview() to authenticated;
create or replace function public.pronto_trial_overview()
returns jsonb language sql stable security invoker set search_path=''
as $$select pronto_private.self_service_trial_overview();$$;
revoke all on function public.pronto_trial_overview() from public,anon,authenticated;
grant execute on function public.pronto_trial_overview() to authenticated;
