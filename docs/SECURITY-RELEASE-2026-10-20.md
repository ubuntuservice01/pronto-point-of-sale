# Pronto POS — Verificação de segurança para publicação (20/10/2026)

Repositório: `ubuntuservice01/pronto-point-of-sale`. Projecto Supabase confirmado: `prontopos` (`xgtpvszwzvkwysrswkek`).

## Evidência executada

- Auditadas 32 tabelas operacionais `public.pronto_*`: todas com RLS activo.
- Teste de isolamento transaccional no Supabase: duas identidades sintéticas autenticadas, empresas A e B, mais uma identidade sem associação. Cada conta consultou apenas os próprios dados nas **12 tabelas** de negócio testadas; a conta externa leu zero registos.
- Tabelas cobertas: `pronto_businesses`, `pronto_memberships`, `pronto_branches`, `pronto_products`, `pronto_batches`, `pronto_stock_movements`, `pronto_customers`, `pronto_cash_sessions`, `pronto_sales`, `pronto_sale_items`, `pronto_payment_allocations`, `pronto_subscriptions`.
- Dados sintéticos gravados apenas dentro de `BEGIN ... ROLLBACK`. Contagem posterior: **0** comerciantes, **0** vendas e **0** associações; não foram criados clientes de teste permanentes.
- Privilégios directos de escrita `INSERT/UPDATE/DELETE` nos 32 recursos: zero para `anon` e `authenticated`. RPCs de escrita são uma superfície diferente que requer ensaios próprios.
- Nenhuma das 30 RPCs públicas `pronto_*` concedia `EXECUTE` a `anon` na auditoria.
- Defeito preventivo corrigido: `public.pronto_debt_ledger` tinha `SELECT/REFERENCES/TRIGGER/MAINTAIN` concedidos a `anon` por ACL, apesar do RLS já barrar as leituras. A migração Supabase `20261020170239_pronto_debt_ledger_least_privilege` revogou privilégios de `anon` e manteve apenas `SELECT` para `authenticated`. Verificado após aplicação: `anon.SELECT=false`, `authenticated.SELECT=true`, `authenticated.UPDATE=false`, `authenticated.TRIGGER=false`, `service_role.INSERT=true`, RLS activo.

## Limites e bloqueios remanescentes

**Ponto 01 — verificado na camada RLS/PostgreSQL (não é autorização de produção).** Depois do primeiro ensaio com 12 tabelas, uma segunda execução usou duas empresas com dois utilizadores sintéticos distintos e um utilizador sem associação, com dados presentes em **30 tabelas operacionais**. Todos os acessos esperados foram aprovados e o terceiro utilizador viu zero linhas. As **2 tabelas internas** (`pronto_plans` e `pronto_product_code_counters`) não permitem leitura directa nem possuem políticas. A transacção terminou com `ROLLBACK` e as contagens posteriores foram 0 comerciantes, 0 vendas e 0 associações. É um teste RLS com identidades simuladas em SQL, não um login HTTP real.
- Projecto sem comerciantes/sessões/vendas reais: ainda não existe prova de fluxo comercial integral com duas lojas reais.
- O advisor ainda assinala `auth_leaked_password_protection` desactivado; activar nas configurações Supabase Auth.
- O advisor continua a sinalizar sete tabelas sem políticas. As duas tabelas internas de `public` foram verificadas como privadas; cinco tabelas estão no esquema privado e a autorização das funções relevantes será revista nos pontos seguintes.
- Os 67 cenários QA em `docs/QA-MANUAL.md` continuam por homologar.
- Restauro de backup, testes Android/iOS/scanner/impressão e requisitos fiscais ainda bloqueiam a publicação comercial.

## Próximas acções

1. **Ponto 02 em seguida:** validar sessões de dois utilizadores reais na Data API/REST e RPCs, com acessos e dados segregados; os ensaios sintéticos no SQL não substituem autenticação HTTP.
2. Realizar teste de registo do comerciante, produto, caixa, venda e reinício da sessão, com auditoria.
3. Completar QA e backups/restauro; configurar domínio, HTTPS, email e política de autenticação antes do piloto.
4. Não apresentar a demonstração IndexedDB como sistema comercial; `/?mode=supabase` permanece modo-piloto até homologação.

Referências: `tests/sql/pronto_core_rls_rollback.sql`, `docs/QA-MANUAL.md`, `docs/ROADMAP-98-RETOMA.md`.

## Contrato de segurança reproduzível

Em 20/10/2026 foi executado com sucesso o teste de metadados de RLS e privilégios, agora reproduzível em `tests/sql/pronto_release_rls_contract.sql`. Confirma 32 tabelas com RLS, sem concessões anónimas e sem escrita directa a partir dos perfis browser. A última pipeline GitHub anterior a esta atualização, no commit `4f117a9`, concluiu com sucesso; o teste automático do commit de documentação deverá ser considerado separadamente.
