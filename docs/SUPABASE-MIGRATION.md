# Pronto POS — migração gradual para Supabase

## Projecto confirmado
- Project ref: `xgtpvszwzvkwysrswkek` (Supabase `prontopos`).
- Public project URL: `https://xgtpvszwzvkwysrswkek.supabase.co`.
- O projecto **não** é `ubuntupos360`, `FARMA360` ou `MobiGest`.
- A chave publishable é uma configuração pública, mas deve ser injectada pelo ambiente de implantação; não guardar chaves administrativas no repositório.

## Estado: fase de fundação, sem cutover
A migração `pronto_pos_core` foi aplicada em 14/10/2026. Criou 21 tabelas `public.pronto_*`, todas com RLS habilitado; elas estão vazias. A tabela `pronto_plans` não tem uma política de leitura pública por escolha de segurança — só o servidor poderá administrá-la. As demais tabelas expõem SELECT condicionado ao vínculo autenticado com a empresa, sem permitir INSERT/UPDATE/DELETE directamente a utilizadores de navegador.

**O código principal do Pronto POS ainda usa Node.js + SQLite no modo autenticado.** A migração prepara o Supabase, mas não torna o frontend ligado a ele. Não publicar uma versão supostamente «migrada» sem adaptar servidor, autenticação e fluxos.

## Próximas fases obrigatórias
1. Definir o modelo de autenticação com Supabase Auth e mapear contas Ubuntu/operadores para `auth.users`; preservar regras de primeira palavra-passe, suspensão e licença. Não migrar hashes de palavras-passe sem estratégia explícita.
2. Implementar a camada de serviço transaccional para operações financeiras e de stock: abertura/fecho de caixa, vendas e pagamentos mistos, idempotência, FEFO por lotes, devoluções, pagamentos de dívida e auditoria. **Nunca permitir a conclusão de vendas como escritas sequenciais feitas pelo browser**.
3. Implementar criação transaccional de empresas, filiais, memberships e primeiro proprietário pelo serviço administrador, com controlo de licenças e sem papel de super-admin forjado no cliente.
4. Migrar o histórico real **somente após** mapear identificadores de negócio/filial, produtos, utilizadores, lotes, vendas, pagamentos e caixa; reconciliação de saldos de stock e total recebido por método; executar migração de ensaio com possibilidade de reversão.
5. Criar políticas de Storage para imagens dos produtos separadas por empresa. Não colocar ficheiros grandes em JSON no PostgreSQL.
6. Testar RLS com dois utilizadores de empresas distintas e operadores dos cinco perfis; confirmar negação explícita de mutações directas.
7. Resolver backups, restauro, domínio HTTPS, monitorização, recuperação de acessos, teste em telemóveis e legislação fiscal antes de comercialização generalizada.
8. Fazer cutover apenas depois de passar a validação funcional e financeira completa; manter o sistema SQLite actual inalterado até lá.

## Variáveis de ambiente
O actual projecto é JavaScript puro / Node, não Next.js; variáveis NEXT_PUBLIC_* não são automaticamente injectadas no bundle. A URL e a chave publicável devem ser carregadas por um módulo de configuração **apenas depois** de o modo Supabase estar implementado. Chaves secret/service-role nunca devem ser enviadas ao navegador.

## Validação inicial
- 21 tabelas próprias, 21 com RLS ligado, 0 registos.
- Migração Supabase: `20261014192010_pronto_pos_core`.
- Security advisor: aviso informativo `rls_enabled_no_policy` exclusivamente para `pronto_plans`, intencional porque nenhum papel de browser recebe acesso ao catálogo de planos.
- O workflow verde de 163 testes do ramo principal refere-se à versão SQLite **anterior** à integração real com Supabase e não valida futuras transacções PostgreSQL.

## Super Administrador Ubuntu Service — identidade global

- A identidade global reside exclusivamente em `pronto_private.ubuntu_super_admins`, com `user_id` referenciado a `auth.users` e uma flag de activação. O e-mail não é usado como permissão de autorização.
- O único mecanismo exposto ao browser é o RPC `public.pronto_admin_status()`, protegido por autenticação e sem parâmetros. Lê a identidade do JWT actual por `auth.uid()` e devolve apenas `true` ou `false`.
- O RPC não permite cadastrar comerciantes, consultar todas as vendas, alterar licenças ou elevar outras contas. Essas operações dependem de APIs administrativas futuras, protegidas no servidor e auditadas.
- A atribuição inicial da conta foi executada separadamente no projecto Supabase depois de confirmar o UID e o e-mail; **não há e-mails nem UUIDs pessoais inseridos nos ficheiros de migração versionados**.
- Na interface isolada `/?auth-check=1`, uma conta com o perfil global activo é reconhecida como «Super Administrador — Ubuntu Service».
- A demonstração estática do Lovable continua separada da autenticação real e o login operacional Node/SQLite ainda não foi migrado.

## Fase 1 — painel administrativo Ubuntu Service (consulta protegida)

- URL de acesso isolado: `/?mode=supabase` ou `/?auth-check=1` (na pré-visualização Lovable, mantenha o token de acesso da pré-visualização).
- Depois de iniciar sessão no Supabase Auth, o perfil global é validado pelo RPC `pronto_admin_status()`. Só o perfil validado é encaminhado ao painel administrativo. Utilizadores comuns permanecem no ecrã de identificação, sem acesso ao painel.
- O RPC `pronto_admin_overview()` é autenticado, de consulta e protegido na base de dados. Lista exclusivamente metadados de empresas, estado das licenças, planos, contagens de filiais e operadores. Não concede acesso aos produtos ou vendas, não disponibiliza movimentos de caixa e não expõe funções de escrita.
- Secções funcionais: **Visão geral**, **Comerciantes**, **Licenças**, **Planos** e **Segurança**. Trocar de secção ou actualizar os dados reconsulta o RPC, permitindo que permissões revogadas deixem de dar acesso.
- Pesquisa local de comerciantes por nome, contacto, plano ou ID, com saída HTML escapada.
- Sessão: acesso e eventual refresh token ficam **apenas na memória da página**; o cliente renova tokens curtos enquanto a página está aberta, termina a sessão ao sair e pede novo login após recarregar a página. Nenhum token é persistido em `localStorage` ou `sessionStorage`.
- Não alterar o modo de demonstração nem o modo Node/SQLite. O cadastro real, alterações, suspensão e atribuição de planos continuam **indisponíveis** até implementação da API transaccional segura com auditoria.
- Estado inicial esperado no Supabase: **zero** comerciantes, **zero** planos. Estes são dados reais; não preencher com exemplos fictícios.
- Testes de browser/móvel e login com palavra-passe da conta real dependem da validação do próprio administrador. Os testes automatizados cobrem o cliente com respostas simuladas; a criação de comerciantes reais e as operações de caixa ainda não foram homologadas.

## Fase 2 — provisionamento comercial no Supabase

- O Super Administrador pode criar comerciantes, planos, licenças e associações de proprietários e operadores em `/?mode=supabase`.
- Todas as alterações passam pelo RPC `public.pronto_admin_mutation`, que exige o UID autorizado, valida os dados, executa cada acção numa transacção e regista auditoria em `pronto_private.admin_actions` e `public.pronto_audit_events` quando há empresa associada.
- Cada empresa e filial principal começam suspensas. O acesso só é permitido quando existir um proprietário activo, uma licença válida e a empresa tiver sido activada. A função `pronto_private.member_role` exige empresa e licença activas.
- A Edge Function `pronto-admin-invite` exige JWT válido, verifica Supabase Auth e o papel global Ubuntu antes de usar a API Admin para enviar um convite. A chave administrativa vive apenas no servidor Supabase.
- Quando o convite é enviado mas a associação falha, recuperar o UID em Supabase Authentication → Users e usar o formulário de associação da conta existente. Não reenviar convites repetidamente.
- Os perfis permitidos são owner, manager, cashier, stock e finance. A conta global Ubuntu Super Admin não pode ser colocada como funcionário de loja.
- A licença é um registo de autorização de serviço, não é uma cobrança M-Pesa/e-Mola.
- Antes de convidar comerciantes reais, configurar SMTP, domínio e URLs de redireccionamento no Supabase Auth.
- O ambiente de ensaio utilizou BEGIN/ROLLBACK. Não foram criados comerciantes ou planos fictícios persistentes.
- O frontend operacional de vendas ainda usa Node/SQLite. Estas operações comerciais de cadastro não activam a escrita de vendas e stock no PostgreSQL. Não anunciar migração financeira completa antes de implementar e testar as transacções de vendas, caixa, stock e dívidas.

## Fase 3 — núcleo de loja Supabase em modo piloto (PostgreSQL)

- A rota `/?mode=supabase` usa Supabase Auth; se a conta for o Super Administrador, abre o painel Ubuntu, e se for um membro com empresa/filial activa e licença válida, abre o **modo piloto de loja**, separado do POS legado.
- Operações implementadas por RPC protegido: `product_create` com código por filial, `stock_receive` com lote, validade e custo, `cash_open`, `cash_close` e `sale_complete` com meios únicos ou repartidos.
- A base calcula os valores a partir dos preços reais dos produtos, não confia nos subtotais do browser. Descontos e pagamentos são validados em cêntimos inteiros; quantidades por artigo têm até três casas decimais.
- Uma venda só é confirmada com a sessão de caixa aberta pelo próprio operador. O registo de venda, artigos, pagamentos, lotes FEFO, baixa de stock e auditoria são efectuados na **mesma transacção PostgreSQL**.
- Cada venda tem uma chave idempotente e hash do pedido. Reenvios idênticos devolvem a referência original, sem duplicar vendas. Se a aplicação ficar sem resposta, mantenha o mesmo pedido para repetir com segurança; não crie nova venda até confirmar o estado.
- O operador confirma manualmente M-Pesa/e-Mola/transferência; ainda não existem webhooks de confirmação dos fornecedores.
- O fecho de caixa reconcilia dinheiro inicial, recebimentos em dinheiro e movimentos do caixa. **Devoluções, dívidas e movimentos de caixa fora de vendas ainda não foram integrados**, pelo que a implementação financeira é parcial.
- Segurança: `pronto_private.member_role` exige empresa activa, membro activo e subscrição válida. As funções com `SECURITY DEFINER` só devolvem dados da empresa/filial do funcionário autenticado; o cliente não dispõe de permissões directas INSERT/UPDATE/DELETE nas tabelas de stock e vendas.
- Os ensaios reais foram executados com uma conta Auth/empresa temporárias dentro de `BEGIN; ... ROLLBACK;`, incluindo: código automático, recepção de lote, pagamento repartido dinheiro/e-Mola, idempotência, rejeição de sobre-venda e reconciliação do caixa. Nenhum artigo, comerciante ou venda fictícios ficaram guardados.
- As contas reais de comerciantes, SMTP de convites, impressão e equipamento, fotografias em Supabase Storage, vendas offline com reconciliação, reservas/vendas em espera sincronizadas, gestão de dívidas, devoluções, relatórios avançados, documentos fiscais e migração de histórico **ainda não foram homologados**.
- A **versão comercial anterior Node.js/SQLite e o modo demonstração não foram substituídos**. Não ligar directamente vendedores reais ao novo modo piloto sem ensaios de carga e de concorrência, backup/restauro, confirmação fiscal e testes E2E no navegador/dispositivos.

## PIN de cinco dígitos e bloqueio de ecrã

- O PIN é definido pelo próprio utilizador **depois de uma autenticação Supabase Auth válida**, no primeiro acesso. Cada comerciante ou colaborador possui um PIN próprio; o proprietário não recebe o PIN dos outros utilizadores.
- O ecrã inicial exige o PIN após login, enquanto existir uma sessão activa; não é uma alternativa para entrar numa sessão encerrada, noutro dispositivo ou após recarregar o navegador. A conta mantém a palavra-passe forte e a recuperação por email. O Super Administrador mantém as mesmas protecções.
- O ecrã bloqueia imediatamente ao a aplicação ficar em segundo plano (`visibilitychange`), ao sair da página (`pagehide`) ou após **3 minutos** sem actividade. Existe um botão **Bloquear** e opção **Alterar PIN**.
- O ecrã de bloqueio oculta os dados e impede novas interacções de UI com a aplicação. O carrinho e pedidos pendentes continuam na memória da sessão enquanto a página não for encerrada. Após fechar o separador ou o navegador, é obrigatório autenticar novamente; rascunhos persistentes são geridos pelo módulo encriptado existente.
- Os PINs são verificados pelo RPC autenticado `public.pronto_session_pin`; a tabela privada guarda **bcrypt (`crypt`, custo 12)**, nunca PINs visíveis. Cinco tentativas erradas provocam bloqueio de **15 minutos** por conta. O número de tentativas é actualizado no servidor com bloqueio transaccional.
- O PIN **não desbloqueia acessos a APIs financeiras por si só** e não substitui Supabase Auth. O bloqueio de ecrã protege a interface e impede chamadas do cliente oficial enquanto bloqueado; para ambientes partilhados ou de alto risco, o controlo tem de evoluir para uma sessão de caixa/dispositivo com validação de desbloqueio no servidor em todas as operações críticas.
- A criação dos colaboradores pelo comerciante passa a estar disponível no menu **Colaboradores** para o perfil **proprietário**. O proprietário pode convidar funções de caixa, gerente, stock e financeiro através da Edge Function `pronto-owner-invite`, que só envia email após verificar o papel de proprietário na empresa. A associação é auditada no RPC `pronto_owner_assign_staff`. Não se atribuem PINs a terceiros nem perfis de novo proprietário.
- Pré-requisitos externos: confirmar SMTP e redireccionamentos de convite no Supabase Auth. O convite por email e a experiência em dispositivos reais exigem homologação com contas reais; a nova modalidade não significa que o POS inteiro já esteja pronto para comercialização.

## Bloco de lançamento 1–10 — Clientes, Dívidas e Cobranças (2026-10-15)

- Migração versionada `20261015180000_pronto_customer_credit.sql` aplicada ao projecto existente `prontopos` (`xgtpvszwzvkwysrswkek`). Define clientes, crédito, dívida, lançamentos, cobranças idempotentes e RPC autenticada `pronto_credit_snapshot`. Não permitir escrita directa pelo browser em tabelas financeiras.
- `src/supabase-credit-ui.js`: clientes e pesquisa, formulário de crédito/limite, dívida/vencimento, cobrança parcial, histórico, extracto imprimível não fiscal, lembrete WhatsApp iniciado por clique e avisos de dívidas vencidas.
- `src/supabase-shop-ui.js` inclui identificação de cliente na venda paga e opção «Vender a crédito». O servidor valida caixa aberto, cliente, limite, lotes FEFO, preço, concorrência, idempotência, permissões e auditoria, gravando venda, stock e dívida na mesma transacção.
- Cobranças requerem caixa aberto e confirmação manual dos recebimentos por dinheiro/M-Pesa/e-Mola/transferência. Não há confirmação por prestador financeiro.
- O cliente mantém referência do pagamento com resposta incerta para evitar que nova tentativa gere cobrança com identificador diferente; verificar histórico antes de repetir.
- O novo fluxo continua piloto enquanto faltarem testes de concorrência, equipamentos reais, restauro, dados reais e requisitos fiscais. Não anunciar facturação certificada.

## Bloco de lançamento 11–22 — Fornecedores, compras e despesas

- Migração: `20261015185000_pronto_finance_purchases_expenses.sql` aplicada ao Supabase `prontopos`.
- Fornecedores: cadastro e edição protegidos por autorização por negócio; stock recebe compras completas com vários artigos, custo de lote e movimento auditado; a compra guarda saldo por pagar.
- Pagamento a fornecedor: saldo reduzido atomicamente e com idempotência. Saídas em dinheiro são registadas no caixa aberto do próprio operador e conciliadas no fecho.
- Despesas: categoria, descrição, montante e método de pagamento. Escrita protegida, confirmação manual, idempotência e baixa de caixa em dinheiro.
- Recorrência: `pronto_expense_schedules` guarda **lembretes**, não efectua pagamentos automáticos. É necessário um agendador de produção e uma política de aprovação antes de marcar a automação financeira concluída.
- Ecrãs Supabase implementados em `src/supabase-finance-ui.js` e acesso via Fornecedores, Compras e Despesas. Valores em centavos inteiros.
- Ainda não estão concluídos: encomendas com aprovação/estado, devoluções a fornecedores, comprovativos via Storage, edição/anulação de despesas com contralançamento, cobranças automáticas e homologação de impostos.
- Prova PostgreSQL com cliente Auth, produtos, fornecedor, compra, despesa, pagamento e fecho de caixa em `BEGIN ... ROLLBACK`, sem persistência de comerciantes ou transacções fictícias.

## Vendas em espera, movimentos de caixa e devoluções (23–30)

- Vendas em espera multi-dispositivo por filial: `pronto_held_sales`, RPC `pronto_hold_action(hold_save/hold_delete)` e `pronto_hold_list`. Carrinhos pertencem ao operador ou podem ser recuperados por proprietário/gerente; não reservam stock nem validam preços para finalização.
- O operador recupera um carrinho na aba «Vendas em espera». Após checkout o sistema procura eliminar o carrinho suspenso; se a eliminação falhar, a venda já concluída não pode ser repetida sem verificar o histórico.
- Entradas/retiradas manuais de caixa: `cash_move` protege operador e caixa abertos, gera auditoria e chave de idempotência. São integradas no saldo de fecho do caixa.
- Devoluções parciais ou integrais pagas: RPC protegida `pronto_return_action`, exclusivamente proprietário/gerente. Valida quantidades já devolvidas e compra original, bloqueia stock e venda, exige confirmação manual, usa UUID idempotente e cria registos em `pronto_return_headers` / `pronto_return_lines`.
- Produtos em condições de revenda criam novos lotes e movimentos `refund`; produtos danificados não regressam ao stock. Reembolso em dinheiro lança movimento de saída de caixa. Digital exige referência e confirmação manual; **não envia reembolso à operadora**.
- Reembolsos sobre vendas a crédito ficam bloqueados até existir reconciliação explícita do saldo da dívida. Nota de crédito/facturação fiscal ainda pendente.
- Uma venda com artigos integralmente devolvidos muda de estado para `refunded`. O histórico não é apagado.
- Ensaio SQL multioperação efectuado com `BEGIN/ROLLBACK`, sem registos de teste persistentes; foram validadas idempotência, stock e reconciliação do caixa.

## Bloco 23–29 — Vendas suspensas, devoluções e movimentos de caixa

- O Supabase contém RPCs autenticadas `pronto_hold_action`, `pronto_hold_list`, `pronto_return_action`, `pronto_return_snapshot`. Migrações versionadas 20261015193000–195000.
- Vendas em espera guardam carrinho por empresa, filial e operador (proprietário e gerente podem consultar toda a filial); não reservam stock. Retomar repete verificação de stock e preços ao finalizar. O cancelamento não é uma anulação de venda paga.
- Devoluções pagas: proprietário e gerente, quantidade parcial/integral validada face à venda e devoluções anteriores, limites financeiros, retorno ao stock **apenas se apto a revenda**, validação de lote e validade, razão e auditoria. Devoluções de vendas a crédito, notas fiscais e confirmação bancária continuam pendentes de homologação.
- Reembolso digital não transfere fundos: exige confirmação manual da transferência antes do lançamento. Retorno em dinheiro exige caixa aberto do próprio operador e saldo suficiente.
- `cash_move` regista entradas e saídas manuais no caixa, com motivo e UUID idempotente; não deve ser usado para duplicar despesas e pagamentos de compras já contabilizados.
- Testes transaccionais no Supabase (BEGIN/ROLLBACK) confirmaram 2 devoluções até 100% da quantidade, reposição selectiva, repetição idempotente, retorno do fundo de caixa, suspender/retomar e movimentos de caixa. Testes reais com equipamentos e fiscalidade ainda pendentes.

## Inventário, alertas e reposição de stock (bloco 36–54 parcial)

- Migrações `20261015201000_pronto_inventory_actions.sql` e `20261015201200_pronto_inventory_lot_prefix_fix.sql` aplicadas. A última corrige a concatenação do identificador de lote de ajuste.
- `pronto_inventory_action`: edição de produto com controlo de revisão (`expected_revision`); contagem física; ajustes positivos e negativos por lote, com motivo e movimento de stock auditado. É proibido alterar a unidade se já existir stock ou histórico de vendas; preços exigem proprietário/gerente.
- `pronto_inventory_snapshot`: lista de produtos, lotes e movimentos, alertas de produtos vencidos, validade próxima, stock baixo e sugestões de compras. A previsão usa vendas dos últimos 30 dias (consumo de 14 dias), stock disponível não vencido e stock mínimo. É uma estimativa e não é enviada ao fornecedor.
- `src/supabase-inventory-ui.js`: separadores Inventário, Alertas e Lista de compras, com exportação CSV; nomes de produtos potencialmente maliciosos são neutralizados para prevenir injecção de fórmulas no Excel.
- Ainda faltam: fotografias com Supabase Storage, importação CSV para base real, leitores físicos, etiquetas, devoluções a fornecedores, transferências entre filiais, variantes, conversão de unidades e homologação de operações concorrentes com vários caixas. Estes itens **não estão concluídos**.

## Bloco 55–64 — Relatórios internos Supabase

- RPC autenticado e somente leitura `public.pronto_reports_snapshot(p_business,p_branch,p_start,p_end)` com SECURITY INVOKER público e função interna SECURITY DEFINER. Permissão de acesso por negócio; caixas podem consultar apenas as suas vendas e sem consolidar filiais. Janela máxima de 366 dias, datas do fuso de Moçambique.
- O painel permite escolher período, filial ou todas as filiais (proprietário, gerente e financeiro), e apresenta vendas, devoluções, recebimentos reais por meio, despesas, operadores, produtos, filiais e dívidas por receber.
- **Importante**: valor das vendas a crédito integra o total vendido, mas não integra os recebimentos até ser pago. Recebimentos de dívidas e reembolsos são tratados separadamente para evitar confusão entre facturação e tesouraria.
- O custo de mercadorias vendidas é calculado por movimentos FEFO e custo do lote. Quando algum custo falta, o relatório não inventa lucro: o valor fica indisponível. Mesmo com custo, lucro é ESTIMADO (não fiscal) e pode não incluir encargos indirectos ou impostos.
- Há exportação CSV protegida contra injecção de fórmulas; o relatório não constitui documento fiscal, declaração tributária ou auditoria contabilística.
- Migração `20261015205000_pronto_operating_reports.sql` aplicada. Testes reais de contas, várias lojas, operações simultâneas e legislação fiscal permanecem pendentes.

## Fotografias reais dos produtos — Storage privado

- Migração `20261015212000_pronto_product_photos.sql`: bucket **privado** `pronto-product-photos` com máximo 3 MB e JPEG, PNG, WebP. Não há URL público de bucket.
- Políticas RLS do Storage validam identificadores UUID de empresa, filial, artigo e ficheiro; leitura permitida aos membros autenticados autorizados da empresa, upload apenas a proprietário, gerente e stock. Nem operadores de outras empresas nem visitantes anónimos devem obter fotografias.
- O formulário do inventário permite escolher ficheiro ou fotografar no telemóvel (`capture=environment`). Depois do envio, a função `pronto_photo_attach` confirma a existência do objecto no bucket e a pertença ao produto e regista a alteração no histórico com controlo de revisão.
- As imagens no catálogo são obtidas com URLs assinadas e temporárias (300 segundos), sem expor o bucket publicamente. A aplicação usa cache temporária dos links. Upload parcial pode deixar ficheiro órfão se a associação de produto falhar; prever limpeza operacional de ficheiros órfãos.
- Testar na produção com operadores reais, iOS/Android, suporte a câmara e internet lenta; não há scanner OCR nem tratamento de imagens em segundo plano.


## Importação de produtos por CSV (2026-10-15)

- Ecrã no módulo **Produtos e stock**, até 100 linhas por ficheiro, com confirmação antes de importar.
- RPC protegida `pronto_import_products_csv`: proprietário, gerente ou stock; cria produtos e stock inicial na mesma transacção, sem sucesso parcial.
- A repetição com a mesma chave idempotente não cria produtos ou lotes duplicados. Falhas requerem confirmar a importação antes de enviar uma nova referência.
- CSV existente suporta `nome;categoria;preco;unidade;stock;minimo;codigo;validade`. Preços são guardados em centavos inteiros e stock respeita a unidade.
- Ainda faltam validações comerciais em equipamentos reais e importações em larga escala; esta funcionalidade não altera as regras fiscais.


## Gestão de filiais pelo proprietário

- `pronto_manage_branch`: criar, renomear, desactivar e reactivar filiais com papel **owner**, licença e isolamento de empresa.
- Para impedir encerramentos acidentais, rejeita a desactivação da única filial activa, de qualquer filial com sessão de caixa aberta, stock positivo ou carrinhos suspensos.
- É gestão de filiais **parcial**: a transferência de stock entre filiais, consolidação completa dos dados e parametrizações individuais continuam pendentes.
- Testado em transacção com rollback; confirmar fluxo com proprietário autenticado no navegador antes de comercializar.

## Transferências de stock entre filiais — 15/10/2026

- Migrações `20261015230000_pronto_stock_transfers.sql` e `20261015230500_pronto_branch_pending_transfer_guard.sql` aplicadas ao mesmo projecto Supabase `prontopos`.
- **Expedir:** proprietário, gerente ou responsável de stock confirma destino, quantidades e motivo; RPC autenticada valida filiais da mesma empresa, existência dos produtos e lotes não vencidos. Debita os lotes FEFO na origem numa só transacção, lança movimentos negativos e cria `in_transit`.
- **Receber:** a filial de destino confirma a recepção física. O servidor localiza o SKU pelo código e, caso não exista, cria artigo equivalente no destino. Se o mesmo código pertencer a um artigo incompatível, recusa tudo; caso contrário cria lotes com custos/validades preservados e movimentos positivos.
- **Cancelar:** apenas uma transferência ainda em trânsito pode ser anulada. O stock volta aos lotes originais, com auditoria. Recebimento e cancelamento posteriores são operações idempotentes ou recusadas quando há conflito.
- Filiais com stock em trânsito (na origem ou destino) não podem ser desactivadas. A conta `finance` pode consultar mas não movimentar.
- A lista mostra 100 transferências recentes por empresa. Entradas em trânsito não podem ser vendidas no destino até recepção; não existe venda, recibo ou pagamento associado.
- Limite por expedição: 40 artigos distintos no servidor; interface até 10 linhas. A expedição é atómica, não possui confirmações parciais de entrega e não permite alteração após receber. Conferir quantidades reais antes da confirmação.
- Testado no PostgreSQL usando `BEGIN/ROLLBACK`, com envio, recepção, anulação, falhas de acesso entre empresas, stock e idempotência. Ainda requer ensaio com várias filiais e dispositivos reais antes de lançamento.

## Gestão dos colaboradores (perfis e suspensão)

- A migração `20261015233000_pronto_owner_manage_staff.sql` permite ao proprietário consultar nome, email, função e estado dos seus colaboradores activos/inactivos.
- Apenas o proprietário altera as funções `manager`, `cashier`, `stock` e `finance`. Nunca promove um colaborador a proprietário e nunca pode suspender o próprio proprietário.
- Suspensão e reactivação são operações no Supabase, auditadas e validadas em cada RPC/RLS por associação activa. Sessões Auth do colaborador podem continuar emitidas; a revogação aplicada é das permissões da empresa, não uma revogação universal do token.
- Após a alteração de função ou reactivação, o colaborador deve terminar a sessão e voltar a entrar para actualizar os menus. PINs e palavras-passe não são expostos ao proprietário.
- Falta homologação com funcionários reais e tratamento especializado de caixas abertos por operadores suspensos; a gestão de sessões de dispositivos permanece parcialmente pendente.

## Recuperação de PIN esquecido — autenticação reforçada

- A migração `20261016111000_pronto_pin_password_recovery.sql` e a Edge Function `pronto-pin-recovery` estão aplicadas no Supabase `prontopos`. A função Edge exige JWT da sessão existente **e nova verificação da palavra-passe** através de Supabase Auth, comparando IDs autenticados; a palavra-passe nunca é enviada à base PostgreSQL.
- A única função que pode alterar o PIN sem o anterior (`public.pronto_pin_recovery_service`) permite EXECUTE exclusivamente ao papel `service_role`, não a utilizadores `anon` ou `authenticated`. O segredo só existe nas variáveis de ambiente da Edge Function e não no browser.
- O PIN recuperado é novamente armazenado como hash bcrypt, não pode repetir o anterior e só é aceite após verificação adicional no servidor. A sessão permanece bloqueada até validar o novo PIN. O reset elimina tentativas falhadas e bloqueio temporário, porque é precedido de reautenticação válida.
- Existe registo privado da recuperação sem gravar PIN ou palavra-passe; intervalo mínimo de 60 segundos entre recuperações. A API de autenticação do Supabase controla tentativas de palavra-passe errada.
- Para usar: no ecrã de bloqueio seleccionar **Esqueci o PIN**, introduzir a palavra-passe da conta, definir e confirmar novo PIN de cinco dígitos. Se a palavra-passe também foi esquecida, primeiro efectuar recuperação de acesso por email (requer SMTP e redirect configurados no Supabase).
- Não existe entrega de PIN a terceiros nem redefinição de códigos pelo proprietário. O fluxo necessita de testes manuais em browsers/dispositivos e confirmação do serviço de email antes de declarar o produto pronto para venda.
