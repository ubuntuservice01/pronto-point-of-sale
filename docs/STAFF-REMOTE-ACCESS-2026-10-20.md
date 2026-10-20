# Pronto POS — Horários de acesso e bloqueio remoto de colaboradores

## Regra aprovada (20/10/2026)
Somente o proprietário da empresa controla o acesso individual dos colaboradores em **Equipa / Utilizadores**.

- **Automático**: opcionalmente definir horas e dias por colaborador. Fora do horário, nenhum RPC comercial, leitura RLS ou fotografia comercial deve ficar acessível. Horários no fuso `Africa/Maputo` (0=domingo).
- **Bloquear agora**: substitui imediatamente o horário até o proprietário mudar o modo.
- **Autorizar agora**: permite acesso fora do horário até o proprietário voltar ao modo automático; não ultrapassa suspensão da conta, cancelamento de subscrição nem desactivação da empresa.
- **Usar horário**: volta a respeitar o horário guardado. Se o horário não estiver activado, o acesso fica livre, respeitando as outras autorizações.
- Suspensão de conta (`pronto_memberships.active=false`) é independente, de prioridade superior. Não altera vendas passadas.
- Controlo é por par `business_id/user_id`; outros comerciantes e o proprietário não são afectados.
- Turnos que passam da meia-noite terminam no dia seguinte. Os dias seleccionados correspondem ao **início** do turno.

## Implementação técnica
- Migração: `supabase/migrations/20261020182100_pronto_staff_remote_access_schedule.sql` (aplicada no projecto Supabase `prontopos`).
- Regra central: `pronto_private.member_role` revê o horário **em cada pedido SQL**; os RPCs e RLS comerciais que a utilizam ficam protegidos no servidor, mesmo com JWT ainda válido.
- `pronto_staff_access_rules`: tabela sem SELECT/UPDATE directo de `anon` ou `authenticated`; funções com autenticação e verificação de proprietário; auditoria de cada alteração.
- `pronto_my_access_status`: apenas devolve o estado de acesso do próprio utilizador, sem dados comerciais.
- UI: vista de equipa, modo manual, dias/horas; no painel operacional faz verificação a cada 5 segundos e ao retomar o separador. O servidor aplica o bloqueio imediatamente, mas a **ocultação visual pode levar até ao próximo ciclo**, especialmente sob restrições de navegador/rede. Se não houver ligação, o ecrã fica protegido e as vendas online não prosseguem.

## Verificações de base confirmadas
- Às 06:59:59 horário negado; 07:00 permitido; 18:59:59 permitido; 19:00 negado.
- Turno sábado 22h–domingo 03h: domingo 02h permitido; 03h negado.
- Tabela tem RLS activo e não concede leitura nem escrita directas a operadores.
- Sem regra explícita guardada, o comportamento anterior é preservado.
- `staff_access_allowed` respeita precedência: suspensão/licença > bloqueio manual > autorização manual > horário.

## Bloqueios antes da publicação
- [ ] Executar o conjunto completo `npm test`, `npm run check`, `npm run build` no CI do PR.
- [ ] Testes HTTP autenticados com duas contas de colaboradores de teste e um proprietário real; demonstrar negação de todas as operações comerciais após bloqueio (incluindo Storage, funções RPC e vendas em curso).
- [ ] Validar sessão já aberta em dois dispositivos, bloqueio remoto, reabertura manual e abertura automática à hora marcada.
- [ ] Confirmar comportamento ao ficar sem internet e reautenticação após expiração do token.
- [ ] Confirmar auditoria e motivos de bloqueio no ecrã; testes Android/desktop.
- [ ] Restaurar e testar backup, validar obrigações fiscais e completar restantes pontos da homologação comercial.

**Não publicado em produção comercial.** O código está isolado numa branch de preparação, sem merge na `main` enquanto os testes manuais e CI não forem aprovados.
