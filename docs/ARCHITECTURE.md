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
