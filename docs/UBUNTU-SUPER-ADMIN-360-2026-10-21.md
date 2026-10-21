# Ubuntu Super Admin 360 — entrega de implementação

## Interface
- Menu: Visão Geral, Comerciantes, Utilizadores, Licenças, Planos, Financeiro, Auditoria, Segurança.
- Indicadores reais e dois gráficos (evolução dos comerciantes existentes, distribuição por planos).
- Acções individuais de comerciantes: editar nome/contactos/morada, suspender, reactivar, arquivar, restaurar e eliminar da lista sem apagar registos financeiros.
- Gestão das filiais: designação e activar/desactivar (desactivação recusa caixa aberto).
- Gestão dos utilizadores: criação com credenciais manuais previamente existente, edição de nome/perfil, bloqueio e reactivação (último proprietário protegido).
- Gestão de licenças: atribuição/renovação anteriormente existentes, cancelamento com motivo.
- Gestão dos planos: criar, editar preço/nome/prazo, activar/desactivar sem reescrever subscrições antigas.
- Recebimentos da plataforma: apenas pagamentos já confirmados fora do POS e registados manualmente, referência única por negócio e meio. Não representa confirmação automática de carteiras móveis.
- Auditoria: historial pesquisável por contexto das novas operações, exportação CSV, acções de emergência com motivos obrigatórios.
- Responsive mobile-first e cores contextuais verdes/vermelhos/laranja.

## Backend
O servidor valida auth.uid e pronto_private.is_ubuntu_super_admin em todas as novas operações. Funções expostas: public.pronto_ubuntu_admin_control, public.pronto_ubuntu_admin_insights e public.pronto_ubuntu_admin_critical. Tabelas de recibos e auditoria isoladas em pronto_private, com RLS e revogação de privilégios directos.

`business_remove` é **eliminação reversível/soft delete** (`removed_at` + `archived_at`, status suspenso). Não se faz DELETE CASCADE porque destruiria vendas, caixa, dívidas, documentos e auditoria. O botão chama-se «Eliminar da lista», não «apagar registos financeiros». A recuperação limpa os marcadores e devolve a loja ao estado suspenso até reactivação autorizada. Um trigger impede reactivação de loja arquivada por RPCs antigos.

As acções críticas de suspensão, reactivação, desactivação de utilizadores e cancelamento de licença exigem motivo de pelo menos 10 caracteres, escrito na auditoria. A protecção de «último proprietário» é mantida.

## Ficheiros
- src/supabase-admin-360.js — KPIs, gráficos, formulários, sessões e auditoria.
- src/admin360.css — cartões e cores responsivas.
- src/supabase-admin-ui.js, src/supabase-admin-model.js, src/supabase-admin-dashboard.js, src/supabase-identity.js — integração.
- index.html, public/sw.js — estilos e PWA.
- supabase/migrations/20261021130000_ubuntu_super_admin_360.sql — alterações idempotentes e funções.
- supabase/migrations/20261021132000_ubuntu_admin_archive_guard.sql — guarda de reactivação.
- supabase/migrations/20261021133000_ubuntu_admin_critical_controls.sql — operações com motivo obrigatório.
- supabase/migrations/20261021134000_ubuntu_admin_private_rls.sql — reforço de segurança.
- tests/supabase-admin360.test.mjs — verificações novas, além dos testes existentes.

## Verificações e limites
As permissões de consulta e mutação foram negadas a utilizador autenticado que não é administrador (SQL do projecto). O GitHub Actions executa sintaxe, testes Node, compilação e verificação do pacote. Ainda é necessária validação manual de todas as acções, incluindo desactivação de acesso já aberto, em dispositivos separados com comerciantes e colaboradores reais. Não foram eliminadas empresas nem feitos testes destrutivos em registos reais.

A função de cobrança regista pagamentos **declarados como recebidos**: exige comprovativo/referência mas não comprova automaticamente a transacção com o operador móvel. O histórico de auditoria visível inclui os eventos do novo módulo; os eventos antigos continuam preservados no registo anterior do sistema.

Não adicionar métricas de vendas privadas ao painel global. A Ubuntu gere subscrições e segurança, e cada comerciante continua dono dos próprios dados comerciais.
