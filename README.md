# Pronto POS

**O seu negócio na palma da mão.** POS geral mobile first da Ubuntu Service, Lda.

## Estado actual — 0.7

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
