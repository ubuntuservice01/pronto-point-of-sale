# Validação antes do piloto

## Automatizada nesta entrega

- [x] Venda fraccionada, total e troco.
- [x] Venda não altera o estado de origem antes da gravação.
- [x] Não vender produto de outro negócio.
- [x] Rejeitar stock insuficiente, quantidade fraccionada de peças e pagamento insuficiente.
- [x] Rejeitar venda pelo perfil de stock.
- [x] Idempotência e rejeição de linhas repetidas.
- [x] Código de barras único por negócio.
- [x] Build e sintaxe JavaScript.

## Navegador e equipamentos: pendente

- [ ] Android/iPhone: sem deslocamento horizontal em 360–430 px.
- [ ] Scanner: permissão aceite, recusada e câmara indisponível.
- [ ] Beep e confirmação visual apenas quando o produto é adicionado.
- [ ] Não duplicar o mesmo código enquanto permanece no enquadramento.
- [ ] Leitor externo: código + Enter; produtos sem código; produto não cadastrado.
- [ ] Criar produto, vender, consultar troco e recarregar o navegador.
- [ ] Instalar aplicação e recarregar offline após cache preparado.
- [ ] Duas abas: alterações concorrentes não perdem vendas ou stock.
- [ ] Inglês: menus, formulários, mensagens e comprovativos.
- [ ] Teclado, leitor de ecrã, foco e contraste.

## Produção: ainda não implementada

- [ ] Autenticação e senhas temporárias.
- [ ] Isolamento de negócios imposto pelo servidor/base de dados.
- [ ] Sessões reais da mesma conta em vários dispositivos e revogação.
- [ ] Sincronização idempotente após reconexão, sem perda de operações.
- [ ] Stock concorrente, conflitos, auditoria e caixa separado.
- [ ] Backup e recuperação testados.
- [ ] Validação fiscal e de pagamentos conforme as integrações contratadas.

## Actualização 0.2

- [x] Contas reais e senha temporária com mudança obrigatória.
- [x] Isolamento e autorização no servidor para negócios, produtos, stock e vendas.
- [x] Mesma conta em sessões diferentes e revogação de sessões.
- [x] Mudança de palavra-passe termina outras sessões.
- [x] API rejeita origem externa e acesso a ficheiros privados.
- [x] Totais calculados no servidor; preço/role/userId enviados pelo cliente não substituem a fonte autorizada.
- [x] Venda idempotente e conflito de operação detectado.
- [ ] Validação visual do novo acesso, credenciais temporárias, criação de negócios e de operadores.
- [ ] Implantação em servidor Node/SQLite persistente, backup e recuperação.

## Front-end — painel Ubuntu e navegação

- Pesquisa por nome de negócio, proprietário e tipo de comércio.
- Filtro por tipo, estado vazio e limpeza dos filtros.
- Detalhes de negócio e abertura do painel; acesso Ubuntu mantém o perfil, sem simular login do proprietário.
- Contactos e estado editáveis exclusivamente na demonstração local; não suspendem contas reais.
- Menu mobile com quatro acessos e menu Mais; Ubuntu acessível também no telemóvel.
- Navegação por hash e botão Voltar do navegador; indicador de carregamento.
- Perfil do cabeçalho abre definições; ícones SVG, acesso por teclado e foco no título.
- Servidor e base de dados não foram alterados nesta entrega.
- Build, testes existentes e verificações de pesquisa/escape passaram. Inspecção visual em navegador/dispositivo ainda pendente.

## Front-end — comerciante e venda rápida

- Atalhos do painel para venda, produtos e histórico, conforme o perfil.
- Barra mobile fixa com total e acesso ao carrinho.
- Atalhos de dinheiro: valor exacto e montantes acima do total.
- Orientação sobre pagamento e valor em falta, antes de enviar a venda.
- Confirmação de limpeza do carrinho, sem alterar stock.
- Rascunho recuperável no mesmo separador, por negócio/perfil, apenas na demonstração local.
- Indicador de gravação e bloqueio de cliques enquanto a operação está em curso.
- Identificador de operação conservado nas tentativas com o mesmo carrinho/pagamento; não é uma outbox offline.
- Leitura com código + Enter só emite beep se o produto for adicionado.
- Quantidades de peças/embalagens devem ser inteiras; quantidades fraccionadas limitadas a três casas decimais na interface.
- Servidor sem alterações. Testes de domínio/HTTP e build passaram; inspecção visual e testes de interacção em dispositivo continuam pendentes.

## Correcção da prévia em branco

- O servidor de prévia aceita --port/--host/--strictPort sem interpretar essas opções como pasta.
- A prévia e o build estático abrem a demonstração do front-end por defeito.
- O servidor autenticado assinala explicitamente modo server no HTML; a API e os dados não foram alterados.
- O arranque mostra uma mensagem recuperável se os módulos falharem, em vez de uma página em branco.
- Testes HTTP verificam index, módulos, MIME types e a diferença entre prévia e servidor: 20 testes passaram.
- Prévia real do Lovable ainda precisa de actualização e validação visual.

## Caixa no front-end

- Demonstração com abertura por negócio/utilizador/dispositivo e saldo inicial.
- Vendas de demonstração exigem caixa aberto e são associadas ao turno na mesma gravação local.
- Entradas/retiradas com motivo; retirada superior ao dinheiro disponível é rejeitada.
- Fecho com valores contados/confirmados para dinheiro, M-Pesa, e-Mola e transferência.
- Diferenças exigem observação; resumo do fecho fica preservado e consultável.
- Modo autenticado apresenta a função como ainda não ligada, sem guardar movimentos no servidor.
- 23 testes passaram, incluindo reconciliação, diferenças, dispositivos e limites. Validação visual continua pendente.


## Frontend — Fase 1: produtos, stock e equipa
- [x] Pesquisa e filtros no catálogo, indicadores de stock e produtos activos/inactivos.
- [x] Edição e activação/desactivação de produtos na demonstração, sem apagar vendas históricas.
- [x] Recepção e ajuste de stock com motivo, quantidades validadas e movimentos locais na demonstração.
- [x] Equipa com pesquisa, filtros, edição de perfil e activação/desactivação na demonstração.
- [x] Perfis proprietário protegidos; produtos inactivos indisponíveis na nova venda e scanner.
- [x] No servidor real, criação e recepção existentes mantidas; operações sem endpoint são explicitamente bloqueadas.
- [x] Endpoints autorizados para edição, activação/inactivação de produtos e ajustes com auditoria no servidor.
- [x] Endpoints de edição/inactivação de colaboradores e revogação de acessos reais.
- [ ] Testar interface e scanner em browser/Android/iOS e executar testes automatizados.

## Fase 2 — Caixa autenticado, descontos e pagamentos mistos
- [x] Operações de caixa no servidor por utilizador/dispositivo/negócio e vendas associadas obrigatoriamente a turno aberto.
- [x] Cálculo autorizado no servidor de descontos fixos, pagamentos repartidos e troco.
- [x] Devolução integral com autorização owner/manager, motivo, restauro de stock, prevenção de repetição e registo por turno.
- [x] Conciliar entradas, saídas, pagamentos mistos e devoluções por método no caixa.
- [ ] Integrar toda a interface da Fase 2 e validar funcionamento em navegadores e equipamentos reais.
- [ ] Integrações externas para confirmar pagamentos e reembolsos M-Pesa/e-Mola (não automáticas).
- [ ] Devoluções parciais e notas de crédito fiscais (fora deste fluxo).


## Fase 2 — Interface de venda e caixa
- [x] Caixa autenticado: abertura, movimentos e fecho pelo servidor.
- [x] Descontos monetários, meios de pagamento repartidos e troco no POS.
- [x] Venda suspensa/retomada na aba actual; não persiste no servidor ou após fechar a aba.
- [x] Devolução integral, motivo e confirmação manual de reembolso; não emite nota de crédito fiscal.
- [x] Comprovativos com desconto e discriminação de meios.
- [ ] Execução da bateria de testes em Node e inspecção visual em dispositivos.
- [ ] Devoluções parciais e reembolsos M-Pesa/e-Mola automáticos.


## Testes adicionais da Fase 2
- [x] Testes de unidade do domínio executados em ambiente JavaScript isolado para desconto, repartição de pagamentos, troco, reposição de stock, idempotência e permissões de devolução.
- [x] Acrescentados testes de integração para caixa autenticado, fecho, venda descontada, devolução e confirmação manual obrigatória.
- [ ] Executar testes Node no ambiente do projecto e validar interface em navegador/equipamento real.


## Fase 3 — Gestão comercial (13/10/2026)
- [x] Menus por perfil para clientes, compras, despesas e relatórios.
- [x] Clientes com contacto, observações, edição e associação opcional à venda.
- [x] Compras com fornecedor, produto, custo unitário, referência e entrada automática de stock.
- [x] Despesas operacionais, separadas de movimentos de caixa.
- [x] Relatórios por datas UTC, vendas brutas/líquidas, devoluções, compras, despesas, histórico diário e produtos mais vendidos.
- [x] Margem bruta parcial estimada apenas a partir de custos conhecidos.
- [x] Exportação CSV e impressão/guardar como PDF do resumo não fiscal.
- [x] Endpoints autenticados e permissões por negócio para gestão comercial.
- [ ] Executar testes completos Node e validação visual real em dispositivo.
- [ ] Fornecedores avançados, compras/vendas a crédito, custos médios e contabilidade fiscal.

## Consolidação da versão 0.4
- [x] `npm run check` inclui o domínio e a interface de gestão comercial.
- [x] Testes automáticos de clientes, compras, despesas, relatórios, protecção de CSV, permissões e isolamento incluídos em `tests/commercial.test.mjs`.
- [x] Execução integrada da suite Node no GitHub Actions: 47 testes aprovados.
- [ ] Testes funcionais em navegador/dispositivos reais.


## Fase 4 — Qualidade e UX (entrega técnica; homologação manual pendente)
- [x] Histórico filtrável por texto, pagamento, estado da devolução e datas UTC; filtros sem recarga integral.
- [x] Carrinho protege contra artigos inexistentes, inactivos, duplicados ou quantidades invalidadas por alterações de stock.
- [x] Abertura de formulários com foco inicial, estados de erro legíveis e campos acessíveis ao teclado.
- [x] Estado de internet do navegador deixa claro que não confirma disponibilidade do servidor.
- [x] Ajustes de navegação, impressão, compatibilidade mobile e foco visível.
- [x] Testes de domínio para qualidade e pipeline de GitHub Actions adicionados.
- [x] CI GitHub Actions — 47/47 testes, sintaxe e build aprovados (13/10/2026; ver Actions).
- [ ] Testes visuais reais em Android/iOS/Desktop, scanner, recibos e caixa físico.


## Scanner horizontal — correcção (13/10/2026)
- [x] Vista de leitura em proporção 16:9, vídeo preenchido sem faixas laterais e moldura horizontal.
- [x] Preferência por câmara traseira com resolução 1280x720 quando o dispositivo permitir.
- [x] Leitura da região visível do vídeo, filtragem de duplicações, mensagens de êxito/erro.
- [x] Opções de ecrã inteiro, trocar câmara, luz quando suportada, reinício e código manual.
- [x] Libertação da câmara quando fecha o diálogo, esconde a página ou redesenha a aplicação.
- [x] Testes de utilidades do scanner e verificação por CI.
- [ ] Confirmar câmara traseira, orientação, foco e leitura com etiquetas reais em Android e iOS.
- [ ] Testar orientação bloqueada e permissões em modo prévia do Lovable (iframe).


## Produtos e Inventário — Fase 0.6
- [x] Edição de dados, preço, código e stock mínimo no servidor, com controlo de revisão.
- [x] Estado activo/inactivo real, sem apagar produtos nem histórico de vendas.
- [x] Receber stock e ajustar contagem com motivo e identificação do utilizador.
- [x] Movimentos de vendas, compras e devoluções registados a partir desta versão.
- [x] Pedidos autenticados isolados por negócio, stock contado protegido contra alterações concorrentes.
- [x] Protecção contra operações repetidas por ID e códigos de barras repetidos no mesmo negócio.
- [x] Histórico dos 20 registos mais recentes com operador; consultas anteriores à versão não são reconstituídas.
- [x] Testes de regras de inventário, isolamento e permissões acrescentados à suite Node.
- [ ] Homologação visual no Lovable/Android e teste de concorrência de dois operadores reais.
- [ ] Paginação, filtros e exportação de todo o histórico para operações de grande volume.

## Equipa — Entrega 0.7
- [x] Editar nome e papel de contas reais com autorização do proprietário.
- [x] Revogar sessões em qualquer alteração de perfil ou estado.
- [x] Desactivação bloqueia login e reactivação conserva a palavra-passe.
- [x] Isolamento entre negócios, impedimento de editar proprietários e controlo de revisão.
- [x] Histórico das alterações de equipa para o proprietário.
- [x] Migração da coluna de revisão nas instalações SQLite existentes.
- [x] Testes de servidor, rotas HTTP e migração integrados no GitHub Actions.
- [ ] Testar sessões com dois dispositivos reais e o fluxo completo de criação/edição nos navegadores.
- [ ] Recuperação de acesso e gestão de credenciais perdidas.


## Super Admin e comerciantes — Fase 0.8
- [x] Super Admin pode editar dados do negócio com motivo, histórico e revisão optimista.
- [x] Suspensão invalida todas as sessões de proprietário/equipa e bloqueia logins futuros.
- [x] Reactivação preserva dados e permite novos logins com credenciais existentes.
- [x] Consulta do histórico administrativo, filtro por negócios activos/suspensos e dados de contacto.
- [x] Migração SQLite aditiva, sem perda dos negócios existentes.
- [x] Rotas de API protegidas contra utilizadores não autorizados e escrita de outras origens.
- [x] Testes de regressão, migração, isolamento e interface acrescentados.
- [ ] Homologar suspensão/reactivação com vários aparelhos reais.
- [ ] Gestão de planos, subscrições e cobranças (não implementada).


## Planos e Licenciamento — Fase 0.9
- [x] Super Admin cria e desactiva/reactiva planos com valor (MZN) e dias de validade.
- [x] Atribuição manual e renovação por períodos sem pagamentos fictícios.
- [x] Licenças expiradas/canceladas bloqueiam operações e login pelo relógio do servidor.
- [x] Licenças e suspensão de comerciantes são controlos independentes.
- [x] Negócios existentes sem licença mantêm acesso legado.
- [x] Renovação idempotente, com revisão e auditoria de acções/operadores.
- [x] Interface do Super Admin e validade visível ao proprietário.
- [x] Testes automatizados de expiração, renovação, migração, permissões e segurança HTTP.
- [ ] Testes reais em browsers e dispositivos físicos, incluindo expiração durante uma venda.
- [ ] Integrações reais de cobrança, notificações, facturação fiscal e validação legal de contratos.


## Data de validade — 0.9.1
- [x] Formulário de cadastro com data de validade opcional.
- [x] Persistência e validação de datas reais no modo autenticado Node/SQLite e demonstração.
- [x] Possibilidade de editar ou retirar a data de validade com auditoria.
- [x] Avisos de vencimento com base na data local de Moçambique.
- [x] Testes automáticos de criação, edição, calendário, API e interface.
- [ ] Controlo de validade por lote, FEFO e bloqueio automático de vendas de produtos vencidos (não incluídos neste pedido).


## Lotes e múltiplas validades — Fase 0.10
- [x] Registar vários lotes do mesmo produto com número, quantidade e validade específica.
- [x] Apresentar listagem e quantidades por lote, incluindo stock anterior sem inventar lote.
- [x] Entrada de lote e correcção por contagem com motivo, utilizador e idempotência.
- [x] Compra de mercadoria associada ao lote, com validação da validade.
- [x] Venda FEFO e impedimento automático de vender unidades vencidas.
- [x] Guardar lotes consumidos por venda e repor os mesmos lotes nas devoluções integrais.
- [x] Servidor com isolamento de comerciante e permissões para movimentos.
- [ ] Testar leitura de códigos reais e venda de lotes no Android/desktop.
- [ ] Etiquetas por lote, gestão de recolhas e normalização de alto volume.

- [x] Corrigir o número e a validade do lote sem alterar o stock, com auditoria e controlo de concorrência.


## Gestão de Dívidas — Pronto POS 0.11
- [x] Criar venda integralmente a crédito, com cliente e data limite obrigatórios.
- [x] Limites de crédito autorizados apenas pelo proprietário/gerente, com histórico e bloqueio individual.
- [x] Limites e dívidas vencidas impedem novas vendas a crédito.
- [x] Registar recebimentos parciais e totais, com confirmação manual e idempotência.
- [x] Integrar recebimentos no caixa sem reconhecer crédito como dinheiro recebido.
- [x] Consultar saldos, vencimentos, histórico, clientes e indicadores de dívida.
- [x] Preparar lembretes WhatsApp sem envio automático.
- [x] Proteger negócios, utilizadores e pagamentos contra acesso indevido ou valores superiores ao saldo.
- [x] Testes automatizados de permissões, checkout, caixa, devoluções e API.
- [ ] Homologar fluxos em navegadores e telemóveis reais e testes de acessibilidade.
- [ ] Cobrança automática, envio programado de avisos e regularização de vendas a crédito já pagas.


## Alertas de Stock e Validade — Versão 0.12
- [x] Avisar por lote quando a validade expirou, vence hoje ou está dentro dos limiares configurados.
- [x] Considerar o fuso horário de Moçambique e usar data única no cálculo de stock disponível/validade.
- [x] Detectar stock baixo e esgotado com base no **stock vendável**, excluindo produtos inactivos dos avisos de reposição.
- [x] Recomendação de compra com base em vendas não devolvidas dos últimos 30 dias e stock mínimo.
- [x] Não fabricar estimativas de procura quando não há vendas recentes.
- [x] Criar lista de compras com cópia e partilha manual pelo WhatsApp, sem efectuar pedidos ou envios automáticos.
- [x] Definir limiares por comerciante com motivo, auditoria e revisão de concorrência.
- [x] Restringir edição dos limiares ao proprietário/gerente; permitir consulta ao responsável de stock sem acesso a dados financeiros.
- [x] Adicionar atalhos à página Início e Produtos e Stock, com interface adaptável ao telemóvel.
- [x] Testes automáticos da lógica, das permissões, do isolamento e da API.
- [ ] Testes visuais em Android e desktop e avaliação de acessibilidade com leitores de ecrã.
- [ ] Envio automático de notificações (ainda não implementado).
