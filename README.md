# Pronto POS

## Entrada pública para piloto (Outubro de 2026)

Em domínio público, o acesso inicia sempre no login real do Supabase: **não são criados nem apresentados produtos, empresas ou vendas fictícios**. A demonstração local é restrita a localhost/127.0.0.1 para testes de desenvolvimento. O servidor Node/SQLite mantém o seu modo autenticado quando identifica `meta[name=pronto-mode]` como `server`.

**Primeira mercearia:** entrar com a conta Supabase de Super Administrador já configurada, criar o comerciante e a filial principal, criar um plano de teste, convidar uma **segunda conta de email** para proprietário e atribuir a licença. O proprietário aceita o convite, define a palavra-passe e o PIN de 5 dígitos, entra, cadastra produtos, abre o caixa e regista vendas reais de teste. O Super Administrador global não pode ser associado directamente como empregado de qualquer loja (proteção no backend).

A base comercial Supabase foi verificada vazia antes do lançamento. Não foram apagados registos. O fluxo de autenticação conta com uma conta global preexistente confirmada; não podemos provar o login sem as credenciais dessa conta. Antes de utilização comercial com clientes, verificar dispositivos, backups, integração fiscal e meios de pagamento. Actualizar a página exige autenticação de novo enquanto o token é mantido apenas em memória.



**O seu negócio na palma da mão.** POS geral mobile first da Ubuntu Service, Lda.

## Estado actual — 0.12

Duas modalidades separadas:

- **Modo autenticado** (`npm start`): servidor Node/SQLite, contas Ubuntu e de comerciantes, criação de negócios, credenciais temporárias, operadores e sessões em vários dispositivos. Produtos, stock e vendas são isolados por negócio e validados no servidor. Nesta fase exige internet; sincronização offline ainda não está implementada.
- **Demonstração local** (`/?demo=1`): dados fictícios em IndexedDB, mudança livre de negócios/perfis e cache para abrir offline. Não possui autenticação nem isolamento de segurança.

Interface mobile em português de Moçambique e inglês. Inclui produtos por unidade/metro/kg/etc., recepção de stock, carrinho, quantidades fraccionadas, troco, histórico e comprovativo não fiscal. Não confirma automaticamente M-Pesa/e-Mola.

A câmara usa BarcodeDetector quando disponível, sob HTTPS ou localhost. Há som, vibração quando disponível e confirmação visual; leitores que escrevem código + Enter e introdução manual também são suportados. Validação com equipamentos reais ainda é necessária.

## Executar

Node.js 22.13 ou superior; esta base não exige pacotes externos.

```sh
npm run dev
npm run check
npm test
npm run build
npm run preview
```

Desenvolvimento: http://localhost:5173. Build estático: `dist/`. Servir na raiz do domínio com HTTPS. Os scripts de servidor são apenas para desenvolvimento e pré-visualização.

## Validação

Os testes iniciais de domínio e servidor cobrem quantidades, arredondamento, troco, stock, idempotência, permissões e associação de produtos ao negócio. Foram acrescentados testes nas versões seguintes; a bateria integral da versão 0.4 ainda exige execução em Node. A verificação sintáctica foi efectuada nos ficheiros alterados. Teste visual automatizado bloqueado pela ausência de Chromium no ambiente; scanner real, instalação e recarga offline exigem validação num navegador/dispositivo.

Ver [plano de arquitectura](docs/ARCHITECTURE.md) e [lista de validação](docs/ACCEPTANCE.md).

## Entrega 0.2 — servidor autenticado

Foi acrescentado um modo real com Node.js e SQLite persistente, isolado da demonstração. Requer Node.js >=22.13 com `node:sqlite` (validado em Node 24). Não depende de Supabase nem exige pacotes externos.

1. Copiar `.env.example` para `.env`.
2. Definir `UBUNTU_ADMIN_USERNAME` e uma palavra-passe própria com pelo menos 12 caracteres; não guardar `.env` no Git.
3. Executar `npm start` e abrir http://localhost:5173.
4. Entrar como Ubuntu, criar um negócio e entregar as credenciais temporárias apresentadas uma única vez.
5. O proprietário muda a palavra-passe, cadastra produtos e cria os colaboradores.

A palavra-passe bootstrap só é aplicada na primeira criação do Super Admin. Alterar essa variável depois não redefine a palavra-passe existente.

Em modo autenticado, contas e sessões são reais: hash scrypt com salt, cookie HttpOnly/SameSite, protecção de origem nos POST, limitação de tentativas de entrada e autorização no servidor. A mesma conta pode entrar em vários dispositivos; sessões podem ser revogadas nas definições. Alterar a palavra-passe termina as outras sessões. A API recalcula o valor da venda e rejeita stock insuficiente e referências a outro negócio. Vendas de caixas são limitadas às próprias operações; o proprietário vê o negócio.

**Ainda não é uma versão pronta para lançamento:** falta validar as interfaces num navegador real, sincronização offline autenticada, conversões de embalagem, recuperação/reset de acessos, suspensão de negócios e monitorização. No modo real, vendas exigem ligação; não existe uma fila offline escondida. As configurações de loja/perfil livres pertencem exclusivamente a `/?demo=1`.

O build `dist/` contém só o cliente; hospedagem estática não executa o servidor. Para usar as contas reais, é necessário alojamento Node com disco persistente. Para produção: HTTPS reverse proxy, `NODE_ENV=production`, `APP_ORIGIN` exacta em HTTPS e acesso restrito ao ficheiro SQLite e aos backups. Não executar várias réplicas com bases SQLite independentes. O servidor de demonstração `npm run dev` não oferece a API; usar `npm start` para esta fase.

Os testes originais cobriam HTTP, cookies, sessões e vendas. A versão 0.5 foi posteriormente validada com 47 testes no GitHub Actions. O teste visual continua pendente pela ausência de Chromium neste ambiente.


## Entrega 0.3 — Venda e caixa
- Caixa real no modo autenticado: abrir turno, entradas/retiradas com motivo, fecho e histórico no servidor, isolados por negócio/utilizador/dispositivo.
- Cada nova venda autenticada exige turno aberto; operações são associadas ao turno e o preço, desconto, pagamentos e stock são validados no servidor.
- Descontos fixos em meticais, pagamentos mistos (dinheiro, M-Pesa, e-Mola e transferência), cálculo do troco e comprovativo não fiscal.
- Devolução **integral** por proprietário ou gerente, com motivo e confirmação do reembolso manual, devolvendo unidades ao stock e preservando a venda original.
- Carrinhos suspensos apenas em memória da aba do navegador; perdem-se quando a aba é fechada ou a página recarregada.
- O sistema **não efectua nem confirma automaticamente** cobranças ou reembolsos M-Pesa/e-Mola. É necessária confirmação humana. Não emite nota de crédito fiscal.
- Offline autenticado continua pendente. A nova fase usa a API Node/SQLite já existente, não o Supabase.
- Testes de integração em Node, navegador e equipamento real continuam a ser obrigatórios antes de uso comercial.


## Entrega 0.4 — Gestão comercial e relatórios
- Clientes: cadastro e edição, contactos e histórico das vendas associadas. A venda pode ser anónima ou atribuída a um cliente existente.
- Compras de mercadoria: fornecedor, produto, quantidade, custo de aquisição e referência. A compra acrescenta stock e actualiza o **último custo unitário** do produto. A compra não é um movimento de caixa.
- Despesas: categoria, descrição e montante, sem afectar automaticamente o saldo do caixa.
- Relatórios: filtros por intervalo de dias UTC, vendas brutas, devoluções, vendas líquidas, compras, despesas, produtos e evolução diária.
- Estimativa de **margem bruta parcial** baseada apenas em linhas de venda com custo de aquisição conhecido no momento da venda. Não é lucro líquido, não substitui contabilidade e não extrapola o custo de mercadorias sem dados.
- Exportação CSV (compatível com Excel, com protecção básica contra fórmulas maliciosas) e opção Imprimir/Guardar como PDF para resumo **não fiscal**.
- Permissões: clientes (proprietário, gerente, caixa); compras (proprietário, gerente, stock); despesas (proprietário, gerente, financeiro); relatórios (proprietário, gerente, financeiro). O financeiro pode ler compras para relatórios, mas não registá-las.
- Backend existente Node/SQLite persiste os dados por negócio; o Supabase continua sem utilização nesta implementação. Não há integração com AT, facturação fiscal, vendas a crédito ou contas correntes.
- Os testes Node e os testes reais de interface/dispositivos devem ser executados antes do lançamento comercial.


## Entrega 0.5 — Qualidade, estabilidade e UX
- Histórico de vendas com pesquisa, filtro por método de pagamento, devolução e datas UTC.
- Carrinho resiliente a alterações de stock e produtos desactivados/eliminados: operações problemáticas são sinalizadas e o botão de venda não permite avançar até à correcção.
- Verificações de quantidades, navegação por teclado, foco nos formulários, adaptação a ecrãs pequenos e aperfeiçoamentos de impressão.
- O estado `Internet detectada` refere-se apenas à conectividade do dispositivo e **não** confirma que a API do servidor esteja operacional.
- GitHub Actions verifica sintaxe, testes automatizados e build em cada push para `main`. Em 13/10/2026, **47/47 testes passaram** no commit `5ec0dde`. A execução posterior deve ser verificada no painel Actions.
- Testes visuais em equipamentos reais e impressoras continuam pendentes. Este resultado não equivale a homologação comercial.
- Consulte [roteiro de testes manuais](docs/QA-MANUAL.md) antes de colocar a aplicação em produção.


## Entrega 0.6 — Produtos e inventário no servidor
- **Edição real de produtos:** nome, categoria, código de barras, preço e stock mínimo. Unidade e saldo não são alterados neste formulário, preservando movimentos e vendas anteriores.
- **Activar/desactivar produtos:** produtos desactivados ficam fora do POS, mas continuam no inventário e no histórico. A reactivação preserva o mesmo produto.
- **Inventário transaccional:** entradas e correcções de contagem exigem motivo. As quantidades são validadas no servidor, inclusive unidades indivisíveis e casas decimais.
- **Auditoria:** os novos registos de criação, edição, estado, entradas, ajustes, vendas, compras e devoluções guardam operador, data, produto, quantidade anterior/actual (quando aplicável), motivo e referência. O frontend mostra os 20 registos mais recentes.
- **Concorrência:** alterações de dados e estado exigem `expectedRevision`; ajustes de contagem exigem `expectedStock`. Em caso de conflito, a interface informa e recarrega dados; entradas acumulativas continuam transaccionais. UUID por operação evita duplicação após tentativas repetidas.
- **Permissões:** só proprietário, gerente e responsável de stock podem alterar inventário. Operadores de caixa não recebem nem eventos de inventário nem custos no snapshot.
- **Limitação:** histórico anterior a esta versão **não é reconstruído**. Os eventos continuam dentro do payload por negócio em SQLite e deverão ser normalizados/paginados antes de escalar para comércio de grande volume.
- A gestão de contas de colaboradores, planos de negócio e outros itens da auditoria mantém-se pendente, assim como homologação de dispositivos reais.

## Entrega 0.7 — Gestão de colaboradores
- Proprietário pode editar nome e perfil de colaboradores, desactivar e reactivar contas no modo autenticado.
- Alteração de perfil ou estado termina todas as sessões desse colaborador, obrigando a um novo login.
- Desactivação bloqueia novos logins; reactivação mantém a palavra-passe existente.
- Contas de proprietário estão protegidas, sem promoção para proprietário ou super administrador.
- Histórico das alterações com responsável e data; as operações anteriores à actualização não são reconstruídas.
- Actualização automática da estrutura SQLite para suportar controlo de revisão e conflitos de edição.
- Validação: 67 testes automatizados aprovados, incluindo segurança, rotas e migração.
- Ainda faltam testes manuais de multi-dispositivo e recuperação administrativa de acessos.


## Entrega 0.8 — Super Admin, comerciantes e suspensão efectiva
- O Super Admin pode pesquisar e filtrar comerciantes por tipo e estado (activo/suspenso), editar a ficha do negócio e suspender/reactivar o acesso de toda a empresa.
- Dados editáveis: nome comercial, tipo, nome de referência do proprietário, contacto, email e endereço. O nome de referência **não altera** o nome de login nem a palavra-passe da conta de proprietário.
- A suspensão **revoga todas as sessões** da empresa (incluindo proprietário e colaboradores) e impede novos logins; a reactivação permite criar sessões novas usando as palavras-passe existentes. Nenhum registo de venda, produto ou stock é eliminado.
- Só o Super Admin executa estas operações, mediante motivo obrigatório. Revisões evitam sobrescrever alterações concorrentes. Um histórico permanente de eventos administrativos é guardado em SQLite, com actor, data, motivo e valores anteriores/novos.
- Migração aditiva de negócios antigos para campos de contacto, `active` e `revision`. O Super Admin ainda pode inspecionar uma empresa suspensa em modo leitura.
- Os planos comerciais, preços de assinatura, cobranças e gestão de mensalidades **não** estão incluídos nesta entrega; não são simulados como se estivessem activos.
- Antes do lançamento comercial, validar os fluxos de suspensão e reactivação em dispositivos reais e a política de comunicação aos comerciantes.


## Entrega 0.9 — Planos, subscrições e licenciamento
- **Super Admin:** cria planos com nome, preço em cêntimos de metical e duração em dias corridos, e pode desactivar/reactivar um plano para novas atribuições. Pode criar planos gratuitos com 0 MZN para períodos de avaliação.
- **Licenças por negócio:** atribuição inicial, renovação por 1 a 12 períodos, cancelamento, data de início e validade calculadas pelo relógio do **servidor**. Planos e licenças são isolados no SQLite; um plano desactivado continua válido para comerciantes a quem já foi atribuído.
- **Acesso efectivo:** licenças expiradas ou canceladas impedem novas sessões e novas operações autenticadas; o Super Admin mantém acesso para gerir/renovar. Os dados, vendas, caixas, produtos e utilizadores não são eliminados.
- **Compatibilidade:** comerciantes existentes **sem licença atribuída** continuam com acesso legado. **Não existe suspensão retroactiva ou atribuição automática de planos**. A suspensão administrativa do negócio permanece independente da validade da licença.
- **Operações manuais:** as referências de pagamento são apenas texto de registo administrativo. **Não há cobrança, confirmação bancária, facturação fiscal, integração M-Pesa/e-Mola nem renovação automática.** O preço configurado não representa um pagamento realizado.
- **Auditoria/idempotência:** autor, motivo, referência opcional, valores antigos/novos e ID de operação são guardados em `license_events`. A renovação com o mesmo ID não duplica a validade; uma repetição com número de períodos diferente é recusada. Concorrência protegida por revisão.
- **Frontend:** painel de planos no Super Admin, estado e histórico na ficha do negócio, atribuição, renovação/cancelamento com confirmação, e informação da validade nas definições do comerciante.
- **API:** `POST /api/plans`, `/api/plans/status`, `/api/licenses/assign`, `/api/licenses/renew` e `/api/licenses/cancel`. Apenas o Super Admin pode chamar estas rotas.
- Os períodos são medidos em **dias de 24 horas**, não em meses de calendário. Todos os horários de licença são armazenados em UTC.
- Continuam pendentes testes visuais no navegador e dispositivos reais, políticas de notificação prévia à expiração, contratos, comprovativos e integração financeira.


## Data de validade dos produtos — 0.9.1
- **Novo produto:** campo `Data de validade (opcional)` (`YYYY-MM-DD`), acessível pelo selector de datas no telemóvel ou computador. Pode ficar vazio para ferragens e outros artigos sem validade.
- **Editar produto:** permite consultar, corrigir ou limpar a data. A actualização segue o mesmo controlo de permissões e revisão do inventário.
- **Produtos e stock:** apresenta a data e identifica automaticamente produtos `Vencido`, `Vence hoje` e `A vencer` (até 30 dias), considerando a data local em Moçambique (Africa/Maputo).
- As datas são verificadas pelo domínio e pelo servidor antes de gravar em SQLite; a demonstração usa IndexedDB. Produtos existentes sem este campo continuam válidos.
- **Limite actual:** existe apenas **uma data por produto**, não por lote ou entrada de mercadoria; os avisos **não bloqueiam automaticamente vendas**. Para controlo de diferentes lotes e datas e restrições à venda, será necessário desenvolver o módulo de lotes/FEFO.


## Entrega 0.10 — Lotes e múltiplas datas de validade (FEFO)
O mesmo artigo aceita vários lotes independentes (número, quantidade e data de validade). Em **Produtos e stock**, abrir **Lotes** para consultar as existências e os prazos por lote, **Receber** para registar um lote e **Ajustar** para corrigir a contagem de um lote específico. As novas compras registadas no formulário comercial exigem número do lote e permitem introduzir a validade. As compras anteriores permanecem intactas.
- **FEFO:** na venda, o sistema escolhe primeiro os lotes disponíveis que vencem mais cedo. Lotes com prazo terminado são **excluídos das vendas automaticamente** no domínio e no POS. Produtos sem validade definida são tratados como não perecíveis e utilizados depois dos lotes com prazo válido.
- **Stock anterior:** unidades existentes antes da activação da gestão por lotes aparecem como **Stock anterior sem lote**. O número do lote **não é inventado** e a validade mantém exactamente a data anteriormente registada no artigo (caso exista). O comerciante pode ajustar essa contagem sem alterar os lotes rastreados.
- **Entradas e compras:** lotes com o mesmo número (para o mesmo artigo) e mesma data agregam quantidades; o mesmo número com validade diferente é rejeitado para exigir correcção explícita. Identificadores de operação evitam duplicações. As compras e as entradas geram eventos auditáveis.
- **Saídas e devoluções:** cada linha de venda guarda os lotes e respectivas quantidades consumidas; a devolução integral repõe as unidades no respectivo lote de origem. A validade é confirmada de novo em cada venda e as alterações são executadas numa transacção SQLite no servidor.
- **Protecção de contagens:** a correcção de lote exige indicar a quantidade actual esperada; se outra operação o alterar, o pedido é rejeitado. Ajustes genéricos não podem reduzir silenciosamente lotes identificados.
- **Limitações:** as vendas históricas anteriores ao novo controlo não dispõem de identificação retroactiva de lotes. A interface permite receber lotes expirados para registar e isolar perdas, mas o POS impede a sua venda. Não há integração fiscal, quarentena automatizada, recolha de lotes ou impressão de etiquetas por lote nesta fase.


### Corrigir número e validade de um lote
Na opção **Produtos e stock → Lotes → Corrigir dados do lote**, pode alterar o número e a data de validade de um lote existente com motivo obrigatório. O servidor verifica se o lote foi alterado entretanto, impede números repetidos no mesmo produto e conserva um histórico de auditoria. Este formulário não altera o stock agregado nem modifica as vendas anteriores; a disponibilidade futura é recalculada com a nova validade.


## Pronto POS 0.11 — Gestão de Dívidas (PT-MZ)
A antiga designação informal de vendas a fiado passa a ser apresentada como **Gestão de Dívidas** em todo o novo módulo. O comerciante pode vender a crédito e acompanhar os saldos por cliente, datas de vencimento, pagamentos parciais e estado de cada dívida.
- **Autorização e segurança:** proprietários e gerentes configuram o limite de crédito em meticais por cliente, com motivo registado e controlo de revisão. Todos os clientes novos começam com limite **0 MT** e não podem comprar a crédito sem autorização expressa. É possível bloquear novas vendas a crédito individualmente. Dívidas vencidas impedem automaticamente conceder novo crédito ao mesmo cliente enquanto não forem regularizadas.
- **Checkout:** seleccionar o cliente, escolher **Venda a crédito** e indicar a **data prevista de pagamento**. A venda regista mercadoria vendida, stock FEFO consumido, recibo não fiscal e uma nova dívida com a referência da venda. O recebimento inicial é **0 MT**; nenhuma quantia entra no caixa no momento da venda a crédito.
- **Pagamentos parciais:** em **Gestão de Dívidas → Registar pagamento**, os operadores com permissão de venda e um caixa aberto podem registar valores recebidos em dinheiro, M-Pesa, e-Mola ou transferência. O sistema impede pagamentos superiores ao saldo em aberto e solicita confirmação de recebimento. Cada operação tem identificador e histórico, e actualiza o saldo remanescente. Pagamentos em dinheiro integram o fecho do caixa; os electrónicos entram nas respectivas colunas de reconciliação.
- **Consulta:** indicadores de total em dívida, valores vencidos, total recebido e dívidas pendentes. Filtros para pendentes, vencidas, liquidadas, anuladas e todas. Histórico de pagamentos individual e estado do limite autorizado no cartão de cada cliente.
- **WhatsApp:** o botão **Lembrar pelo WhatsApp** abre uma mensagem já preparada para o número moçambicano do cliente. **Não envia automaticamente mensagens** nem obriga o comerciante a ligar uma API de WhatsApp.
- **Relatórios:** vendas a crédito integram as vendas totais, mas **não representam dinheiro recebido**. Recebimentos de dívidas são apresentados em separado e **não** são contados novamente como vendas. O caixa também diferencia crédito concedido e valores recuperados.
- **Devoluções:** uma devolução integral de venda a crédito **sem pagamentos** anula o saldo em dívida e repõe o stock. Caso a dívida já tenha pagamentos, a devolução automática é recusada até existir um fluxo próprio de regularização/reembolso, evitando inconsistências financeiras.
- **Dados anteriores:** clientes, vendas e stock anteriores são preservados. A migração é aditiva no payload JSON de cada empresa (arrays `debts`, `debtPayments`, `debtEvents`).
- **Limites:** não existe cobrança electrónica automática, verificação por M-Pesa/e-Mola nem envio automatizado de lembretes. O modo autenticado requer ligação à internet e não oferece sincronização offline de cobranças.


## Pronto POS 0.12 — Alertas Inteligentes de Stock e Validade
O novo menu **Alertas** permite ao proprietário, gerente e responsável de stock anteciparem problemas nas existências. Existe ainda um resumo na página **Início** e uma ligação em **Produtos e Stock**.
- **Alertas por lote:** vencidos, vencem hoje, próximos da validade em **7 dias** (urgentes) e até **30 dias**. Cada aviso identifica artigo, lote, quantidade e data, incluindo stock legado com validade previamente declarada. A data é calculada no fuso de Moçambique (`Africa/Maputo`).
- **Stock vendável:** stock baixo (igual ou inferior ao mínimo do artigo) e ruptura de stock são determinados pelas unidades **ainda vendáveis**; lotes vencidos não entram nessa quantidade. Produtos inactivos não geram sugestões de reposição.
- **Sugestões de reposição:** a quantidade é estimada a partir das vendas **não devolvidas** dos últimos 30 dias, para uma cobertura inicial de **14 dias**, respeitando o stock mínimo. Quando não há vendas recentes, a sugestão baseia-se **apenas no mínimo configurado**. O sistema nunca inventa procura nem efectua encomendas automaticamente.
- **Filtros e acções:** pesquisar por artigo/lote, filtrar por tipo de alerta, abrir a ficha de lotes e receber novo lote directamente a partir de um aviso. Criar uma **lista de compras sugerida** para copiar ou partilhar manualmente pelo WhatsApp; o utilizador decide o envio e as quantidades.
- **Parâmetros configuráveis:** o proprietário e o gerente ajustam o número de dias de antecedência, urgência e cobertura de reposição, com motivo registado e revisão optimista. As definições são por negócio e persistem em SQLite ou IndexedDB na demonstração. O responsável de stock pode consultar os alertas, mas não alterar os parâmetros.
- **Privacidade:** o servidor fornece ao perfil de stock apenas as quantidades vendidas agregadas por artigo, **sem expor facturas, clientes ou valores de vendas**. Só os perfis autorizados recebem parâmetros e eventos de alertas.
- **Sem cobranças ou notificações ocultas:** os avisos surgem na interface ao consultar o negócio; não existem notificações push, envio automático WhatsApp ou descontos automáticos. O módulo actualiza os cálculos ao recarregar/navegar para a página.
- **Escalabilidade:** para muitos milhares de produtos e lotes, é recomendado normalizar e paginar dados de stock e vendas; a versão actual utiliza os snapshots existentes por negócio.
