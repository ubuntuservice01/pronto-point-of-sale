-- Pronto POS / release SQL contract (read-only).
-- Validate from Supabase SQL editor with audit permissions; no user-data mutations.
DO $audit$
DECLARE count_total integer; count_rls integer; anon_read integer; anon_write integer; auth_write integer; internal_count integer; unsafe_policies integer;
BEGIN
 SELECT count(*),count(*) FILTER(WHERE c.relrowsecurity),
 count(*) FILTER(WHERE has_table_privilege('anon',c.oid,'SELECT')),
 count(*) FILTER(WHERE has_table_privilege('anon',c.oid,'INSERT') OR has_table_privilege('anon',c.oid,'UPDATE') OR has_table_privilege('anon',c.oid,'DELETE')),
 count(*) FILTER(WHERE has_table_privilege('authenticated',c.oid,'INSERT') OR has_table_privilege('authenticated',c.oid,'UPDATE') OR has_table_privilege('authenticated',c.oid,'DELETE'))
 INTO count_total,count_rls,anon_read,anon_write,auth_write
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'pronto_%';
 IF count_total<>32 OR count_rls<>32 OR anon_read<>0 OR anon_write<>0 OR auth_write<>0 THEN
 RAISE EXCEPTION 'Security contract failed: tables %, RLS %, anon SELECT %, anon write %, authenticated write %',
 count_total,count_rls,anon_read,anon_write,auth_write; END IF;
 SELECT count(*) INTO internal_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('pronto_plans','pronto_product_code_counters')
 AND c.relrowsecurity AND NOT has_table_privilege('anon',c.oid,'SELECT')
 AND NOT has_table_privilege('authenticated',c.oid,'SELECT')
 AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname);
 IF internal_count<>2 THEN RAISE EXCEPTION 'Internal tables are exposed';END IF;
 SELECT count(*) INTO unsafe_policies FROM pg_policies p
 WHERE p.schemaname='public' AND p.tablename LIKE 'pronto_%'
 AND (p.roles::text LIKE '%anon%' OR p.qual='true' OR p.with_check='true');
 IF unsafe_policies<>0 THEN RAISE EXCEPTION 'Open policy detected: %',unsafe_policies;END IF;
END $audit$;
SELECT 'PASS: Pronto security contract verified' AS result;
