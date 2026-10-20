# Pronto POS — Lista reconstruída de retoma (98 pontos)

Esta é uma nova lista operacional, não uma cópia da auditoria original. [V] = verificar/homologar; [D] = requer desenvolvimento ou integração adicional. Nenhum item está marcado como concluído sem evidência individual. Retomar pelo ponto 01.

## Segurança
- [ ] 01 [V] Validar RLS entre empresas (12 tabelas aprovadas no ensaio A/B; homologação completa pendente)
- [ ] 02 [V] Validar leitura isolada
- [ ] 03 [V] Validar escrita isolada
- [ ] 04 [V] Validar permissões por perfil
- [ ] 05 [V] Rever funções RPC
- [ ] 06 [V] Testar parâmetros inválidos
- [ ] 07 [V] Validar suspensão
- [ ] 08 [V] Verificar exposição de configurações
- [ ] 09 [V] Validar acesso a fotografias
- [ ] 10 [V] Auditar alterações administrativas

## Acessos e equipa
- [ ] 11 [V] Validar convite do proprietário
- [ ] 12 [V] Validar criação de colaboradores
- [ ] 13 [V] Validar suspensão de colaborador
- [ ] 14 [V] Validar PIN
- [ ] 15 [V] Validar recuperação de PIN
- [ ] 16 [V] Validar recuperação de palavra-passe
- [ ] 17 [V] Validar encerramento de sessões
- [ ] 18 [V] Proteger conta do proprietário
- [ ] 19 [V] Preservar histórico de colaboradores
- [ ] 20 [V] Testar gestão de equipa em dispositivos

## Super Admin
- [ ] 21 [V] Validar registo de comerciantes
- [ ] 22 [V] Validar painel Super Admin
- [ ] 23 [V] Validar suspensão da empresa
- [ ] 24 [V] Validar planos
- [ ] 25 [V] Validar atribuição de licenças
- [ ] 26 [V] Validar renovação de licença
- [ ] 27 [D] Integrar cobrança de subscrição
- [ ] 28 [D] Criar avisos de renovação
- [ ] 29 [V] Validar perfis de administração
- [ ] 30 [V] Testar expiração durante venda

## Produtos e stock
- [ ] 31 [V] Validar cadastro do artigo
- [ ] 32 [V] Validar código automático
- [ ] 33 [V] Validar pesquisa de artigos
- [ ] 34 [V] Validar fotografias
- [ ] 35 [V] Validar importação CSV
- [ ] 36 [V] Validar recepção de stock
- [ ] 37 [V] Validar ajustes de stock
- [ ] 38 [V] Validar lotes
- [ ] 39 [V] Validar datas de validade
- [ ] 40 [V] Validar FEFO
- [ ] 41 [V] Validar alertas de inventário
- [ ] 42 [D] Melhorar paginação do inventário

## Vendas
- [ ] 43 [V] Validar carrinho mobile
- [ ] 44 [V] Validar scanner da câmara
- [ ] 45 [V] Validar leitor externo
- [ ] 46 [V] Validar quantidade e stock
- [ ] 47 [V] Validar descontos
- [ ] 48 [V] Validar troco
- [ ] 49 [V] Validar pagamentos repartidos
- [ ] 50 [V] Validar idempotência das vendas
- [ ] 51 [V] Validar vendas em espera
- [ ] 52 [V] Validar devolução total
- [ ] 53 [V] Validar devolução parcial
- [ ] 54 [V] Validar comprovativos

## Caixa
- [ ] 55 [V] Validar abertura de caixa
- [ ] 56 [V] Validar movimentos de caixa
- [ ] 57 [V] Validar limites de retirada
- [ ] 58 [V] Validar meios de pagamento no caixa
- [ ] 59 [V] Validar cobranças de dívida no caixa
- [ ] 60 [V] Validar fecho de caixa
- [ ] 61 [V] Validar caixa de colaborador suspenso
- [ ] 62 [V] Validar auditoria da diferença de caixa
- [ ] 63 [V] Validar repetição de operações
- [ ] 64 [V] Testar fecho físico de caixa

## Finanças
- [ ] 65 [V] Validar clientes
- [ ] 66 [V] Validar limite de crédito
- [ ] 67 [V] Validar bloqueio de dívida vencida
- [ ] 68 [V] Validar cobranças parciais
- [ ] 69 [V] Validar extractos
- [ ] 70 [V] Validar fornecedores
- [ ] 71 [V] Validar despesas
- [ ] 72 [V] Validar relatórios financeiros
- [ ] 73 [V] Validar margem de lucro
- [ ] 74 [D] Integrar verificação de pagamentos móveis

## Filiais
- [ ] 75 [V] Validar criação de filiais
- [ ] 76 [V] Validar acesso por filial
- [ ] 77 [V] Validar expedição de stock
- [ ] 78 [V] Validar recepção de stock transferido
- [ ] 79 [V] Validar cancelamento de transferências
- [ ] 80 [V] Validar pendências de filial
- [ ] 81 [V] Validar idempotência de transferências
- [ ] 82 [V] Testar transferências simultâneas

## Interface
- [ ] 83 [V] Validar menu inferior
- [ ] 84 [V] Corrigir pesquisas e painéis de pagamento
- [ ] 85 [V] Validar legibilidade no telemóvel
- [ ] 86 [V] Validar acessibilidade
- [ ] 87 [V] Validar traduções
- [ ] 88 [V] Validar cache PWA
- [ ] 89 [D] Implementar sincronização offline autenticada
- [ ] 90 [V] Testar scanner e impressão

## Produção
- [ ] 91 [V] Executar CI completo
- [ ] 92 [V] Executar QA-01 a QA-67
- [ ] 93 [V] Testar restauro de backup
- [ ] 94 [V] Validar logs
- [ ] 95 [V] Testar falhas de rede
- [ ] 96 [V] Verificar requisitos fiscais
- [ ] 97 [V] Realizar piloto
- [ ] 98 [V] Documentar aprovação de produção

## Execução de 16/10/2026 — início dos blocos 01–10, 43–64 e 91–96

- **01–10 — auditoria preliminar, NÃO homologados:** o projecto Supabase `xgtpvszwzvkwysrswkek` foi confirmado activo; as 32 tabelas `public.pronto_*` consultadas têm RLS activado. Isto **não comprova** políticas correctas ou isolamento real por utilizador. O advisor de segurança indicou 7 tabelas com RLS e sem políticas (incluindo duas públicas que podem estar deliberadamente inacessíveis), e **protecção contra palavras-passe comprometidas desactivada**. Exige avaliação antes de habilitar acessos adicionais.
- **61–63 — reforço parcial do código:** commits `c8070a3`, `7fa3ea7` e `dffb6fd`. A resposta da RPC de fecho excepcional é confrontada com a sessão, montante contado e equação financeira; a UI deixa de reportar «fecho não confirmado» apenas porque falhou a actualização posterior ao fecho. **Não equivalem a reconciliação presencial homologada.**
- **43–60 e 64 — por testar individualmente;** não marcar como completos.
- **91 — CI por confirmar para o commit mais recente.**
- **92–96 — dependem de QA manual, backups reais, logs operacionais, rede e enquadramento fiscal; não homologados.**

**Próxima operação técnica:** ensaio RLS com duas identidades de empresas distintas sem alterar dados produtivos, e investigação das políticas de SELECT/INSERT/UPDATE antes de qualquer aprovação comercial. Critério para levantar bloqueio: evidência de isolamento real, vendas/caixa idempotentes e testes de recuperação.


## Execução de 20/10/2026 — isolamento A/B e permissões de dívidas

- [x] Teste SQL transaccional A/B e utilizador externo em 12 tabelas; todas as consultas deram o resultado esperado. Dados revertidos por ROLLBACK.
- [x] Revisão RLS: 32/32 tabelas operacionais têm RLS activo; sem escrita directa por `anon`/`authenticated`.
- [x] Corrigidos privilégios excedentes de `anon`/`authenticated` em `pronto_debt_ledger`; migração Supabase `20261020170239` aplicada e verificada.
- [ ] **Ponto 01 não homologado integralmente:** validar restantes políticas, RPCs, Storage e autenticação real em duas contas com dados de teste controlados.
- [ ] Publicação comercial continua bloqueada por QA manual, backups/restauro e requisitos fiscais; ver `docs/SECURITY-RELEASE-2026-10-20.md`.
