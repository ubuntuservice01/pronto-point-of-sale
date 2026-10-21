# Pronto POS — Homologação das áreas 02 a 14
**Data da revisão:** 21/10/2026 · **Âmbito:** projecto Supabase `prontopos`, repositório `ubuntuservice01/pronto-point-of-sale`.

## Critérios e estados
- **AUTOMATIZADO:** existe ensaio técnico repetível no CI, com mocks ou regras do domínio; não prova funcionamento em loja.
- **PARCIAL:** existe funcionalidade testada no código/Postgres mas ainda requer ensaio real e/ou integração adicional.
- **PENDENTE:** falta prova fundamental ou trabalho que não pode ser executado a partir do GitHub.
- **HOMOLOGADO:** só depois de evidência real, operador/responsável, data, dispositivo, teste aprovado e riscos legais resolvidos.

## Matriz H02–H14
| Área | Ensaio técnico | Evidência real obrigatória | Estado |
|---|---|---|---|
| **H02 Caixa** | Fecho cego, saldo esperado, diferenças e bloqueios em testes Node e SQL com rollback; `tests/homologacao-02-14.test.mjs` | Abertura com 0 MT, venda, reforço, retirada, fecho físico e remoto com operador/proprietário em dois terminais | **PARCIAL** |
| **H03 Login e PIN** | Recuperação do refresh token, PIN de cinco dígitos, suspensão e timeout simulados | Entrar, actualizar, encerrar/reabrir PWA e bloquear/desbloquear no Android e no PC; testar falha de Internet | **PARCIAL** |
| **H04 Segurança entre comerciantes** | Leitura RLS A/B com utilizadores sintéticos em transacção e auditoria de 35/35 tabelas com RLS | Ensaios HTTP reais de REST/RPC/Storage com dois comerciantes, leituras e escritas negadas, tentativa de adulterar IDs | **PARCIAL** |
| **H05 Funcionários e perfis** | Regras por função, vista autorizada e auditoria em testes Node | Funcionários de caixa, stock e gerente num telemóvel cada; bloquear uma sessão remotamente e confirmar interdição imediata | **PARCIAL** |
| **H06 Devoluções** | Normalização de quantidades e formulário com confirmação humana e restrição de reembolso | Devolução total/parcial, vários lotes, crédito parcialmente pago, reembolso físico e electrónico comprovado | **PARCIAL** |
| **H07 Produtos e stock** | Rejeição de venda acima da existência, lotes e controlo FEFO em SQL/unitários | Duas vendas simultâneas no último artigo, vencimento em dia local, inventário, lotes e verificação de saldos | **PARCIAL** |
| **H08 Offline autenticado** | Rascunho encriptado e isolado por utilizador/loja/filial; caixa offline com idempotência | **Venda offline completa ainda não implementada/homologada.** Validar sincronização após queda de ligação em aparelhos distintos, sem duplicar | **PENDENTE** |
| **H09 Super Admin** | Funções administrativas autorizadas, histórico e gráficos com dados reais em testes | Editar/suspender/reactivar empresa e operador em sessões distintas; cancelar plano/licença em curso | **PARCIAL** |
| **H10 Clientes e dívidas** | Limite de crédito, vencimento, pagamento parcial e validação manual de recebimento | Cobrar dívida a partir de vários caixas simultâneos, reconciliação de meios e devolução de venda com dívida | **PARCIAL** |
| **H11 Android, PWA, scanner** | Browser Chrome emulado 360 px e desktop; assets versionados no service worker | Android/iPhone, instalação e reabertura reais, leitor USB e câmara, sem cortar texto/botões | **PARCIAL** |
| **H12 Impressão e recibos** | Recibo operacional escapado, troco, CSS de impressão e documento claramente não fiscal | Impressora térmica física 58 mm e 80 mm; PDF em Chrome/Android, corte e caracteres | **PARCIAL** |
| **H13 Relatórios** | Lucro estimado não é apresentado como confirmado se custos estiverem incompletos; CSV e agregados de compras/vendas | Confrontar com livro de caixa, talões, dívidas, custos, lotes e período de datas reais | **PARCIAL** |
| **H14 Backup e recuperação** | Verificações read-only da base e controlo de versão das migrações | **Restauro de backup — PENDENTE:** evidenciar snapshot recuperável, cópia segura, restauro numa base isolada, consistência e tempo de recuperação | **PENDENTE** |

## Verificações directas de hoje, sem alteração de dados
- Supabase: **35** tabelas `public.pronto_*`, **35** com RLS activo; **0** RPCs públicas `pronto_*` executáveis por `anon`. Em revisão de permissões, **0** tabelas com SELECT concedido a `anon` e **0** concessões directas INSERT/UPDATE/DELETE para `authenticated`.
- Base de dados contém **2 comerciantes, 4 vendas, 0 sessões de caixa abertas/registadas** no instante consultado. Não foram alterados.
- Aviso de segurança por tratar: `auth_leaked_password_protection` desactivado. Ver [configuração recomendada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Aviso informativo: 12 tabelas sem políticas RLS, incluindo tabelas internas; confirmar se o bloqueio de acesso directo é intencional antes de abrir permissões.
- Ensaio SQL adicional `tests/sql/pronto_cash_control_rollback.sql` **não pôde prosseguir**: `fixture_requires_licensed_owner` (não existia uma conta de proprietário de teste elegível para a função). A transacção falhou e foi revertida; contagens de produtos, vendas, sessões e políticas **inalteradas**. Não marcar como aprovado. Repetir apenas com conta piloto autorizada, nunca forçar dados em loja operacional.
- O projecto Lovable está publicado, mas uma URL pública e CI verde **não** demonstram homologação real.
- O ficheiro `docs/QA-MANUAL.md` contém **67 testes manuais ainda marcados Pendente**. Não foram aprovados em massa.
- A versão do README inclui passagens históricas desactualizadas sobre sessões e modos; usar esta matriz e as verificações actuais para decisões de lançamento.

## Execução automática
`node --test tests/homologacao-02-14.test.mjs`

Além disso, o CI executa `npm run check`, `npm test` e `npm run build`, incluindo testes Node e, quando o Chromium está disponível, testes de interface em navegador. Um teste com mock **não substitui** verificação via duas contas verdadeiras.

## Guia de prova operacional
Para cada caso de `docs/QA-MANUAL.md`, registar: **ID, loja/filial, data em África/Maputo, perfil do operador, dispositivo/browser, passos, resultado (Aprovado/Reprovado), referência de evidência e revisor**. Não usar dados pessoais em logs públicos. Documentar uma falha como reprovada, não esconder o problema.

**Teste de loja real:** proprietário, operador de caixa e responsável de stock usam sessões diferentes, num computador e num telemóvel, com os mesmos artigos e movimentos; executar simultaneidade e reconciliar com os valores físicos. Não fazer testes destrutivos na loja produtiva.

## Limites de lançamento
- Enquanto H02–H07 e H09–H10 não tiverem testes reais aprovados, restringir uso a piloto supervisionado.
- H08: nunca anunciar capacidade de vendas totalmente offline. O software apenas protege certos rascunhos/movimentos e não confirma uma venda sem o servidor.
- H12: **comprovativo de venda não é factura fiscal certificada**, nem inclui automaticamente integração com a Autoridade Tributária.
- H14: **Sem prova de restauro, não publicar em larga escala**. A restauração deve ser feita numa base isolada e nunca sobrepor a base em produção.
- Confirmar com especialistas locais os requisitos de facturação/AT e retenção antes de vender o Pronto POS como software de facturação certificado.

## Regra de aprovação
Só assinalar **HOMOLOGADO** com evidência de execução real e aprovação explícita na respectiva linha de QA. Os testes automáticos desta revisão não alteram esse estado.
