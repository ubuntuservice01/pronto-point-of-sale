-- Business-owned document identity; never shared across tenants.
create table if not exists public.pronto_document_settings (
  business_id uuid primary key references public.pronto_businesses(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 120),
  phone text not null default '' check (length(phone) <= 48),
  address text not null default '' check (length(address) <= 220),
  email text not null default '' check (length(email) <= 180),
  primary_color text not null default '#0E9384' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#17354A' check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  template text not null default 'modern' check (template in ('classic','modern','compact')),
  footer_note text not null default '' check (length(footer_note) <= 250),
  logo_path text not null default '' check (
    logo_path = '' or (
      logo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|webp)$'
      and split_part(logo_path,'/',1) = business_id::text
    )
  ),
  updated_at timestamptz not null default now()
);

alter table public.pronto_document_settings enable row level security;
revoke all on public.pronto_document_settings from anon;
grant select, insert, update on public.pronto_document_settings to authenticated;

create policy pronto_document_settings_read on public.pronto_document_settings
 for select to authenticated
 using (pronto_private.member_role(business_id) is not null);
create policy pronto_document_settings_insert on public.pronto_document_settings
 for insert to authenticated
 with check (pronto_private.member_role(business_id) = 'owner');
create policy pronto_document_settings_update on public.pronto_document_settings
 for update to authenticated
 using (pronto_private.member_role(business_id) = 'owner')
 with check (pronto_private.member_role(business_id) = 'owner');

-- Logos are private; stored under the exact owning business UUID.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('pronto-document-logos','pronto-document-logos',false,2097152,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy pronto_document_logo_read on storage.objects
 for select to authenticated
 using (
  bucket_id = 'pronto-document-logos'
  and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg|webp)$'
   then pronto_private.member_role(split_part(name,'/',1)::uuid) is not null
   else false end
 );

create policy pronto_document_logo_upload on storage.objects
 for insert to authenticated
 with check (
  bucket_id = 'pronto-document-logos'
  and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg|webp)$'
   then pronto_private.member_role(split_part(name,'/',1)::uuid) = 'owner'
   else false end
 );
