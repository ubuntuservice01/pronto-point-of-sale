-- Fase 1: painel de consulta do Super Administrador Ubuntu Service.
-- A consulta contém apenas metadados de negócios e contratos (nunca produtos,
-- dados financeiros detalhados, clientes ou movimentos dos caixas).
create or replace function pronto_private.ubuntu_admin_overview()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare payload jsonb;
begin
 if not pronto_private.is_ubuntu_super_admin() then
   raise exception 'admin_required' using errcode='42501';
 end if;

 select pg_catalog.jsonb_build_object(
   'businesses', coalesce((
     select pg_catalog.jsonb_agg(
       pg_catalog.jsonb_build_object(
         'id', b.id, 'name', b.name, 'status', b.status,
         'phone', coalesce(b.phone,''), 'address', coalesce(b.address,''),
         'created_at', b.created_at,
         'branches', (select count(*) from public.pronto_branches br where br.business_id=b.id),
         'operators', (select count(*) from public.pronto_memberships m where m.business_id=b.id and m.active=true),
         'plan_name', p.name, 'plan_id', s.plan_id,
         'expires_at', s.expires_at, 'license_cancelled', s.cancelled
       ) order by b.created_at desc, b.id
     )
     from public.pronto_businesses b
     left join public.pronto_subscriptions s on s.business_id=b.id
     left join public.pronto_plans p on p.id=s.plan_id
   ), '[]'::jsonb),
   'plans', coalesce((
     select pg_catalog.jsonb_agg(
       pg_catalog.jsonb_build_object(
         'id', p.id, 'name', p.name, 'price_cents', p.price_cents,
         'duration_days', p.duration_days, 'active', p.active
       ) order by p.name,p.id
     ) from public.pronto_plans p
   ), '[]'::jsonb),
   'generated_at', now()
 ) into payload;
 return payload;
end;
$$;

revoke all on function pronto_private.ubuntu_admin_overview() from public, anon, authenticated;
grant usage on schema pronto_private to authenticated;
grant execute on function pronto_private.ubuntu_admin_overview() to authenticated;

-- Exposed wrapper never elevates its caller. The inner function authenticates
-- auth.uid() again before accessing the privileged administrative metadata.
create or replace function public.pronto_admin_overview()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
 select pronto_private.ubuntu_admin_overview();
$$;

revoke all on function public.pronto_admin_overview() from public, anon, authenticated;
grant execute on function public.pronto_admin_overview() to authenticated;
