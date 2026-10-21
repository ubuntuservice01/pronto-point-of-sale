# Pronto POS — Gestão de Caixa v2 | 21/10/2026

## Âmbito e regras existentes preservadas
Implementação aditiva à estrutura atual do POS Supabase. Os cálculos de venda, pagamentos M-Pesa/e-Mola, stock FEFO, cobranças, devoluções, idempotência e histórico existentes foram preservados. Nenhuma conta de comerciante, venda, produto ou subscrição existente foi apagada.

## Funcionalidades ligadas à base de dados
1. Política **por filial**: abertura de caixa obrigatória (padrão seguro) ou opcional, fecho cego activado/desactivado apenas pelo proprietário.
2. Abertura associada ao utilizador, loja, filial e terminal, com fundo inicial inclusive **0 MT**; impossibilidade de duas sessões abertas no mesmo terminal físico da filial.
3. Separação entre pagamentos: o saldo físico considera fundo + vendas em dinheiro + cobranças em dinheiro + reforços − retiradas − reembolsos em dinheiro, com movimentos confirmados. Pagamentos M-Pesa/e-Mola e transferência constam do relatório, mas não somam dinheiro na gaveta. Fundo inicial não conta como venda.
4. Fecho pedido pelo operador: a sessão deixa de aceitar novas vendas/movimentos até contagem/fecho.
5. Fecho cego protegido também no servidor: antes de fechar, o operador não recebe saldo esperado nem a discriminação que permita inferi-lo; o proprietário e gestor autorizado podem ver os totais. A contagem fecha a sessão e regista esperado, contado e diferença sem alterar operações originais.
6. Supervisor: bloqueio/desbloqueio de sessão, separado de suspensão/bloqueio da **conta** já existente; encerramento administrativo sem conferência com motivo e **sem** registar contagem fictícia; todas as alterações auditadas.
7. Justificação imutável por anexo ao registo, sem actualizar a declaração inicial. Histórico das últimas 100 sessões por filial com CSV. Formulários grandes para telemóvel e vermelho/laranja/verde por resultado.
8. Abertura opcional: vendas podem ser lançadas sem sessão; são registadas normalmente na loja mas não associadas a qualquer gaveta.
9. Movimentos de caixa preparados sem Internet no **dispositivo autenticado já aberto**: rascunhos encriptados AES-GCM com frase privada, isolados por utilizador/loja/filial, referências de idempotência permanentes, **sincronização manual**, sem lançamentos automáticos. O aparelho bloqueia fecho com movimentos locais ainda pendentes. Erros de rede preservam o mesmo pedido para tentativa segura.

## Base de dados — migrations
- `20261021111500_cash_control_v2.sql` — política, campos complementares, índice único por terminal, registo de justificações, cálculo e RPC `pronto_cash_control`.
- `20261021113000_cash_legacy_integration.sql` — operações antigas passam a respeitar política/estado de sessão sem substituir a lógica financeira existente.
- `20261021120000_cash_justifications.sql` — notas auditadas sem editar a contagem.
- `20261021121500_cash_private_totals_permissions.sql` — protege o cálculo privado dos acessos directos por funcionários.
- `20261021122500_optional_sale_without_drawer.sql` — coluna `session_id` de vendas permite NULL quando a política dispensa abertura.

## Verificações efectuadas
- SQL transaccional **com ROLLBACK**: abertura 0 MT e 2.000 MT; duplicação de terminal; política obrigatória/opcional; venda mista 20 MT dinheiro + 50 MT e-Mola; venda M-Pesa 70 MT separada do saldo físico; repetição de venda sem duplicação; reforço de 50 MT; retirada de 10 MT; fecho cego com falta; pedido de fecho bloqueando movimentos; bloqueio/desbloqueio remoto; fecho administrativo sem contagem; justificação posterior imutável; permissões simuladas de operador que impedem divulgação do saldo esperado e alterações de administração.
- `tests/sql/pronto_cash_control_rollback.sql` guardado no repositório para repetição controlada.
- Testes Node: `tests/supabase-cash-control.test.mjs` e `tests/supabase-cash-offline.test.mjs`; teste de encriptação/decriptação, rejeição de palavra-passe errada, isolamento local de contas e renderização das regras.
- GitHub Actions Pronto POS Quality: sintaxe, testes automatizados, build e verificação dos módulos sem falhas na revisão final.

## Limites e pendências relevantes
- **Não é POS totalmente offline**: a venda offline continua como carrinho/rascunho e não é fiscal nem financeiramente confirmada; os movimentos físicos de caixa podem ser guardados offline, mas não são contabilizados antes da confirmação no servidor.
- **Fecho remoto noutro dispositivo**: o servidor não consegue conhecer um registo ainda exclusivamente offline num telemóvel desligado. Um proprietário noutro dispositivo pode fechar administrativamente essa sessão; nesse caso, o movimento pendente permanecerá guardado e precisará de revisão manual, sem ser lançado automaticamente numa sessão já fechada. Para garantia operacional entre dispositivos, estabelecer protocolo de fecho com terminais online e movimentos confirmados.
- O operador só consegue criar/sincronizar rascunhos offline quando a aplicação já estiver aberta e autenticada. Não existe novo login offline, sincronização autónoma em segundo plano ou garantia caso o aparelho/armazenamento seja perdido ou limpo.
- Falta homologação real com **proprietário + colaborador** em dois dispositivos, teste de ecrã móvel e falhas de rede simultâneas. A CI não prova operação no aparelho nem teste real de várias lojas isoladas.
- Falta definir procedimento para divergências quando uma sessão foi encerrada remotamente antes da sincronização de um terminal desligado e verificar requisitos fiscais para comercialização. O bloqueio da conta existente é independente do bloqueio do caixa.
- Aviso existente na análise de segurança: protecção contra palavras-passe comprometidas ainda desactivada nas configurações do Auth; é uma recomendação separada.

## Publicação
Integrar no `main` só após CI verde. Fazer a publicação a partir do commit verificado. Não prometer homologação comercial integral até fechar as pendências acima.
