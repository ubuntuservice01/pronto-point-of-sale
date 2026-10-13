# Arquitectura e fases do Pronto POS

## Decisões aprovadas

- Plataforma multiempresa da Ubuntu Service; Super Admin cria negócios e acessos de proprietários.
- Proprietário cria colaboradores individuais e atribui permissões.
- POS geral para mercearias, ferragens, cosméticos e outros negócios.
- Prioridade ao smartphone; português de Moçambique e inglês.
- Scanner com beep de sucesso e confirmação visual; alternativa manual.
- Offline após configuração inicial; sincronização automática ao recuperar ligação.
- Mesma conta em vários dispositivos, com sessões e identificação separadas.
- Impressora e leitor externo opcionais.

## Entrega 0.1: interface e domínio local

Implementada sem dependências externas: ES modules, CSS responsivo, IndexedDB e service worker. A persistência grava venda e stock no mesmo readwrite transaction, serializando alterações entre separadores do mesmo navegador. Valores monetários em centavos; quantidades em três casas decimais. Armazenamento local contém negócios de demonstração; não é uma implementação segura multiempresa.

Funções puras do domínio rejeitam produto de outro negócio, quantidades inválidas, venda sem permissão e pagamento insuficiente. Essas validações deverão ser repetidas e impostas pelo servidor, sem confiar em role ou tenantId enviados pelo cliente.

## Fundação de produção: próxima fase

Entidades: businesses, branches, warehouses, users, memberships, roles, permissions, devices, sessions, products, product_variants, product_units, stock_movements, suppliers, purchases, customers, sales, sale_items, payments, cash_sessions, cash_movements, expenses, sync_operations e audit_events.

Toda entidade operacional deve ter business_id e, quando necessário, branch_id/warehouse_id. Chaves e referências compostas devem impedir vínculos entre negócios. Políticas no servidor/base de dados devem conferir a associação activa do utilizador, permissões e negócio de cada recurso. Super Admin é uma conta real da Ubuntu, nunca uma escolha pública de perfil.

Criação de negócio e acesso inicial num fluxo transaccional. Senha temporária de uso restrito, alteração obrigatória, recuperação segura e armazenamento de hash no servidor. Nenhuma palavra-passe em claro ou em ficheiros de demonstração. Definir o provedor de autenticação/base de dados antes de executar migrações.

Mesma conta pode ter várias sessões revogáveis. Sessão de caixa independente por caixa/dispositivo quando necessário. Auditoria identifica utilizador, sessão e dispositivo. Autorização de suporte Ubuntu deve ser explícita e auditada.

## Unidades e conversões

Unidade base por produto. Cada unidade alternativa tem factor de conversão e preço próprio: caixa de 12 unidades, saco de 25 kg ou rolo de 100 m. Venda desconta quantidade convertida na unidade base; a conversão usada fica no item da venda. Uma conversão nova nunca deve alterar vendas históricas.

Esta entrega suporta unidades e quantidades fraccionadas; ainda não implementa conversões de embalagens, unidades personalizadas ou variantes.

## Offline de produção

Outbox IndexedDB por utilizador/negócio/dispositivo. Cada operação recebe UUID e permanece até confirmação do servidor. Servidor valida sessão, associação, permissões e conteúdo; UUID tem unicidade por negócio e garante idempotência. Venda, pagamentos e stock são confirmados atomicamente no servidor.

Estados reais: pendente, a enviar, confirmada, rejeitada, conflito. Repetir com backoff, sem marcar sucesso só porque navigator.onLine é true. Sincronizar automaticamente no arranque, reconexão e periodicamente enquanto a aplicação está aberta; oferecer botão manual. Background Sync é opcional, pois não existe em todos os dispositivos.

Stock concorrente offline: nenhum dispositivo conhece as operações não enviadas dos demais. Escolher limites de venda offline ou aceitar stock negativo com revisão autorizada e alertas. Não descartar vendas para esconder diferenças. Permissões revogadas enquanto offline precisam de política de validade e reconciliação. Mudança de negócio ou logout deve preservar e proteger pendências, sem permitir acesso a dados de outra pessoa.

## Fases seguintes

1. Validar interface, scanner, acessibilidade e instalação em Android e iOS.
2. Implementar autenticação, contas Ubuntu, negócios e isolamento real.
3. Ligar produtos, stock, caixa e vendas ao servidor; testar sessões concorrentes.
4. Implementar unidades alternativas, compras, clientes/crédito, despesas, devoluções e relatórios.
5. Outbox e sincronização offline real, testes de falha e conflitos.
6. Piloto, backups, recuperação, monitorização e implantação.

Registo de M-Pesa/e-Mola não confirma pagamentos; integração será uma fase separada. Comprovativos de demonstração não são documentos fiscais.

## Actualização 0.2 — fundação autenticada implementada

Servidor HTTP nativo e SQLite: businesses, users, sessions, payloads e audit. O estado operacional de cada negócio está, nesta fase, num payload JSON independente; o esquema relacional detalhado acima continua a ser a evolução prevista. Transacções BEGIN IMMEDIATE serializam alterações de stock/vendas. Este é um servidor único com armazenamento persistente, sem integração com o serviço de hospedagem estática.

Isolamento imposto pela associação business_id da conta. Clientes não podem atribuir a si mesmos perfil, utilizador ou negócio na venda. Super Admin cria negócios/acessos e pode consultar um negócio explicitamente, mas não opera caixas. O proprietário cria colaboradores; perfis têm permissões impostas no servidor. Sessões são independentes, têm expiração de oito horas e tokens guardados por hash; credenciais iniciais exigem alteração. Identificação de dispositivo é declarada pelo cliente e serve para identificação na lista, não como prova de identidade.

Autenticação cliente usa cookie HttpOnly; nenhuma palavra-passe é guardada em IndexedDB/localStorage. Endpoints API não são armazenados pelo service worker. Operações autenticadas são online nesta etapa. O demo local tem outro fluxo, continua sem segurança e não é utilizado como cache de dados reais.

Pendências antes de produção: testes visuais e scanner, reset seguro de acessos, suspensão/revogação de colaboradores, recuperação do Super Admin, outbox autenticada, sincronização e conflitos offline, caixas/turnos completos, conversões e stock_movements normalizados. Backups e restauro de SQLite precisam de procedimento operacional e validação.


## Fase 2 — actualização do caixa e vendas
A venda autenticada exige caixa aberto no mesmo negócio, utilizador e dispositivo indicado na sessão autenticada. O servidor ignora o deviceId de venda enviado pelo cliente e associa a operação à sessão de login, evitando que um pedido escolha outro caixa. O controlo de caixa, venda e stock é persistido no payload do negócio sob transacção SQLite.

O servidor recalcula subtotal, desconto fixo, alocação exacta de pagamento por meio e troco do montante recebido em dinheiro. Os movimentos de devolução são autorizações administrativas de devolução integral; apenas proprietário/gerente podem registar, um motivo e confirmação explícita de reembolso manual são obrigatórios. Não existe integração financeira para executar devoluções automáticas, emissão de notas de crédito fiscais ou suporte a devoluções parciais. Reembolso registado é uma declaração do operador; não é prova bancária.

O carrinho suspenso é temporário na aba; não equivale a uma encomenda persistida, reserva de stock ou venda sincronizada. A operação autenticada continua a exigir internet e o software ainda requer validação de campo.

Na Fase 2, descontos monetários são permitidos apenas aos perfis proprietário e gerente; o servidor valida esta autorização, mesmo que um cliente envie valores manipulados.


## Fase 3 — Gestão comercial
As entidades comerciais (`customers`, `purchases`, `expenses`) são listas dentro do payload JSON independente de cada negócio, ainda não tabelas normalizadas. Todas as operações são validadas e autorizadas no servidor por perfil e associação ao negócio, com gravação transaccional em SQLite. Criar ou editar clientes requer a permissão `customers`; compras requerem `purchases`; despesas, `expenses`. O snapshot autenticado filtra estas listas segundo as permissões de leitura.
As compras aumentam o stock e registam o custo unitário da última aquisição, preservando custos anteriores nas linhas de vendas históricas. Uma venda armazena o custo vigente como fotografia histórica (`line.cost`) e opcionalmente associa `customerId`, validado no negócio. As vendas antigas podem não ter custo, pelo que a margem estimada é deliberadamente parcial. Valores financeiros são armazenados como inteiros de cêntimos, quantidades em até 3 casas decimais.
Relatórios são agregados no cliente a partir do snapshot autorizado e filtrados por data UTC. A exportação CSV contém dados operacionais; não é certificado fiscal nem um livro de contabilidade. Para escalabilidade, futura evolução deverá normalizar compras, fornecedores, custos, clientes, despesas e auditoria.


## Fase 0.6 — Inventário auditável
O domínio `src/inventory.js` centraliza três operações: `editInventoryProduct`, `setInventoryStatus` e `recordInventoryMovement`. O servidor Node/SQLite executa mutações dentro da transacção `BEGIN IMMEDIATE` existente, valida as permissões `stock` e o negócio da sessão e guarda o evento de auditoria juntamente com a mudança de produto ou quantidade.

Edição e alteração de estado exigem `expectedRevision`. Ajustes de contagem exigem `expectedStock`; quando houve alteração concorrente são recusados (409), para evitar sobreposição silenciosa. A recepção acumulativa não exige contagem antiga, mas é idempotente através de identificador UUID enviado pelo frontend (que se mantém estável durante uma repetição do formulário). Quantidades têm precisão máxima de 3 decimais, com unidades indivisíveis em inteiros.

O histórico `inventoryEvents` e a lista `stockMovements` armazenam as novas entradas, ajustes, vendas, compras e devoluções. Ambos são filtrados por negócio/permissão no snapshot. Identificadores de utilizador vêm do servidor; nomes de operadores são resolvidos pela tabela de utilizadores. Movimentos antigos não foram reconstruídos. Como estas listas estão incorporadas no payload JSON do negócio, devem tornar-se tabelas com índices e paginação numa futura fase de escalabilidade.


## Fase 0.8 — Admin de comerciantes
A tabela `businesses` conserva uma revisão optimista e campos de contacto, `active` e `revision`, acrescentados por migrações `ALTER TABLE` compatíveis com versões antigas. Uma nova tabela `business_events` guarda eventos de criação, edição e suspensão/reactivação (utilizador autor, motivo, momento, valores antes/depois). As operações `businessEdit` e `businessStatus` exigem perfil `super`, motivo e revisão actual, sendo executadas em transacções `BEGIN IMMEDIATE`.
A suspensão limpa as sessões associadas a todos os utilizadores da empresa. A autenticação verifica o estado do negócio tanto em `login` como em `session`, de modo que cookies anteriormente emitidos não possam continuar a operar depois da suspensão. O Super Admin conserva consulta administrativa para reactivação; operações comerciais permanecem proibidas ao perfil `super`.
Planos, facturação da subscrição e notificações ao cliente não foram implementados.


## Fase 0.9 — Licenciamento SaaS
SQLite cria `subscription_plans` (nome, preço em cêntimos, duração em dias, activo), `subscriptions` (um por negócio, plano, início/fim em milissegundos UTC, revisão e cancelamento) e `license_events` (actor, evento, validade anterior/seguinte, período, motivo, referência opcional). A migração é aditiva: negócios já cadastrados não recebem automaticamente subscrição, logo conservam acesso `legacy`.
O estado efectivo `legacy | active | expired | cancelled` é calculado no momento da requisição com a função `now()` do servidor. `login`, `session` e `businessFor` verificam a licença em cada acesso autenticado, mantendo `super` capaz de gerir lojas expiradas. Uma licença não altera a coluna `businesses.active`: suspensão administrativa e expiração da licença têm causas diferentes. A renovação contabiliza dias de 24 horas e, quando activa, prolonga a partir do vencimento actual.
Operações do Super Admin usam transacções SQLite, revisão e ID idempotente, conservando as licenças no estado autorizado mesmo após falhas/repetição de rede. Esta camada **não** tem gateway financeiro, serviços de pagamento, emissão de facturas, envio de notificações nem renovação automática.


## Fase 0.10 — Lotes e validade
A entidade `stockBatches` é guardada no payload de cada negócio em SQLite, com `id`, `tenantId`, `productId`, `number`, `expiryDate` e `quantity`. O stock agregado (`products[].stock`) permanece disponível para compatibilidade. A quantidade de **stock legado sem lote** é calculada pela diferença entre o saldo do produto e a soma dos lotes identificados; não são atribuídos lotes nem prazos artificiais.
A alocação FEFO em `src/batches.js` ignora lotes expirados no dia local de Moçambique (Africa/Maputo) e ordena os restantes por validade crescente, tratando ausência de validade como última prioridade. `createSale` grava `batchAllocations` por linha e reduz saldos dos lotes no mesmo estado transaccional. `refundSale` restaura as quantidades aos lotes registados; as vendas anteriores sem alocações continuam a gerar stock legado quando devolvidas.
`receiveBatch` e `adjustProductBatch` possuem autorização de `stock` no servidor e verificações de idempotência/concorrência. `recordPurchase` aceita `batchNumber` e `expiryDate` para actualizar os lotes com os movimentos comerciais. Clientes e API antigos sem lote ainda podem representar entradas não rastreadas por compatibilidade, mas o formulário comercial novo exige um número.
Para escalar a grandes volumes, devem ser normalizados lotes e movimentos numa estrutura relacional indexada por negócio/produto/validade e aplicada paginação na consulta do histórico.


## Fase 0.11 — Gestão de Dívidas
Entidades por negócio no payload SQLite: `debts` (id/saleId, customerId, amount, dueDate, createdAt), `debtPayments` (debtId, customerId, amount, method, reference, cashSessionId, userId) e `debtEvents` (alterações administrativas de limite/bloqueio). `customers` passa a incluir `creditLimit` em centavos MZN, `creditBlocked` e `creditRevision`, inicializados a 0/falso/0. Os registos anteriores não são alterados.
A venda de método `credit` é **integralmente a crédito** (sem pagamentos mistos). `createSale` valida cliente, limite de exposição, bloqueio, dívidas vencidas e data futura/actual no calendário de Moçambique; cria a dívida na mesma transacção que diminui o stock FEFO. As vendas a crédito permanecem nas estatísticas de volume de vendas, mas não são incluídas nos métodos monetários do caixa.
O endpoint `POST /api/customers/credit` só aceita proprietário/gerente, com revisão optimista. `POST /api/debts/payments` só aceita utilizadores com permissão de vender e caixa aberto nesse dispositivo. Os valores são registados como recebimentos manuais, reconciliados em `cashSummary`, sem provedores de cobrança. Idempotência e verificações de saldo ocorrem dentro da transacção SQLite. Cancelamentos de vendas com dívidas pagas são bloqueados até existir tratamento de reembolsos.
Os dados por negócio são segregados; perfis sem acesso ao módulo não recebem `debts` nem `debtPayments`. Lembretes WhatsApp são hiperligações abertas explicitamente pelo utilizador e não são enviados pelo servidor.
