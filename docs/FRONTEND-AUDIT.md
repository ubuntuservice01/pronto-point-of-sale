# Pronto POS — Auditoria funcional do frontend
**Data:** 13/10/2026 · **Repositório:** ubuntuservice01/pronto-point-of-sale · **Base de dados:** Node/SQLite no modo autenticado.  
**Método:** leitura do código-fonte, rotas e permissões; testes automatizados pelo GitHub Actions. **Não** equivale a teste visual em navegador/dispositivo real.

## Alteração efectuada agora — scanner horizontal
- Modal mais largo e preview fixo em 16:9 com object-fit: cover, área de leitura central.
- Preferência por câmara traseira e 1280 × 720, com alternativa caso o browser recuse as restrições.
- Câmara frontal/traseira, lanterna quando suportada, expandir para ecrã inteiro, reiniciar e inserir código manual.
- Detecção na região correspondente à imagem visível; evitar leitura repetida do mesmo código a cada frame; mensagem visual de leitura.
- Libertação do stream ao fechar o diálogo, redesenhar a aplicação ou passar a aba para segundo plano.
- Restrições: um navegador, especialmente dentro do iframe do Lovable, pode bloquear o bloqueio de orientação e o ecrã inteiro. O formato da **pré-visualização** é horizontal, mas a orientação **física do sensor** depende do telemóvel. Sem suporte a BarcodeDetector, resta leitura manual/leitor externo.

## Situação dos módulos — prova pelo código
| Área | Confirmado no código | Por concluir / limitação | Prioridade |
|---|---|---|---|
| Navegação e dashboard | Menus por perfil e navegação móvel; painéis e contadores | Rever visualmente a visibilidade de todos os módulos em cada perfil e a navegação no botão Mais | Alta |
| Scanner | Câmara, código manual, scanner automático condicionado ao BarcodeDetector; pré-visualização 16:9 nova | Teste físico de foco, auto leitura e orientação; alternativa de leitura para navegadores sem BarcodeDetector (ex.: biblioteca ZXing) | Alta |
| Produtos | Cadastro, pesquisa, edição, activação e desactivação **reais** no modo autenticado, com motivo e histórico | Falta edição de fotografias/variantes e validação visual em aparelhos reais | Média |
| Stock | Entradas, ajustes físicos, compras, vendas e devoluções com movimentos auditáveis por operador, data e motivo | Histórico anterior à versão 0.6 não recuperável automaticamente; lista actual só mostra os 20 mais recentes; exportação e paginação por implementar | Alta |
| Equipa | Criar contas, editar perfis, desactivar/reactivar e revogar sessões no servidor | Recuperação administrativa de acesso e testes multi-dispositivo reais | Média |
| Vendas | Carrinho, pagamentos mistos, desconto autorizado, troco, venda transaccional no servidor | Suspender/retomar venda não persiste após recarregar; testar fluxo de leitura + venda real | Alta |
| Caixa | Abrir, entrar, retirar, conciliar e fechar no servidor | Conferir impressão de fecho em dispositivos reais, trilho de auditoria e diferenças operacionais | Alta |
| Devoluções | Devolução integral com motivo e confirmação de pagamento manual | Devoluções parciais, nota de crédito fiscal e integração real de reembolsos | Alta / Legal |
| Clientes | Cadastro, edição e associação às vendas | Histórico detalhado por cliente, contas-correntes e crédito | Média |
| Fornecedores/compras | Compras com nome de fornecedor e custo, reposição de stock | Cadastro único de fornecedores, pagamentos pendentes, ordens de compra e devoluções a fornecedores | Média |
| Despesas | Criar e consultar despesas | Editar/anular lançamento com auditoria e anexar comprovativos | Média |
| Relatórios | Filtros por data, CSV, impressão, margem parcial, produtos mais vendidos | Lucro líquido real, custos médios, impostos e relatórios fiscais; testes reais de exportação | Alta para uso comercial |
| Super Admin | Criar, editar, filtrar por estado e suspender/reactivar comerciantes no servidor, com revogação de sessões e histórico | Planos, subscrições, cobranças e recuperação administrativa de acesso ainda por implementar | Alta |
| Perfil/Definições | Idioma, logout e gestão de sessões | Alterar dados do negócio/perfil, mudar senha após login e recuperação de credenciais | Média |
| Pagamentos | Métodos dinheiro, M-Pesa, e-Mola, transferência com confirmação manual | Cobrança/verificação automática e reconciliação real de M-Pesa/e-Mola/transferências | Alta |
| Recibos/Impressão | Comprovativo **não fiscal** e função de impressão do navegador | Tamanhos 58/80 mm, QR, impressão Bluetooth/ESC-POS, numeração e facturação fiscal certificada onde aplicável | Alta |
| PWA/offline | Demonstração IndexedDB, instalação PWA e cache de activos | Modo autenticado offline com fila segura/sincronização de vendas, prevenção de conflitos | Média / Alta |
| QA | CI de sintaxe, testes Node e build | Validação em telemóveis reais Android/iPhone, tablet, scanner físico, impressora térmica e vários operadores simultâneos | **Obrigatória** |

## Ordem recomendada de conclusão
1. **Bloqueadores de operação real remanescentes:** suspensão administrativa de comerciantes e validações reais de scanner, caixa e impressão.
2. **Fluxo de balcão completo:** piloto Android com scanner horizontal; testar caixa, venda mista, troco, suspensão e retorno; rever comprovativos e impressão.
3. **Operação comercial:** gestão de comerciantes/planos, fornecedores e despesas com anulação auditável.
4. **Pagamentos/fiscalidade e hardening:** conectores financeiros reais, documentos fiscais/legalidade, backups, recuperação, sincronização e testes em dispositivos.

### Validação
A CI anterior ao documento passou com **51/51 testes** e build, mas o scanner ainda não foi experimentado num Android/iPhone físico a partir deste ambiente. Qualquer falha revelada pelo teste no Lovable deve gerar um caso reprodutível, antes de considerarmos essa parte concluída.

## Actualização — Inventário autenticado (13/10/2026)
Produtos e stock deixaram de ser acções apenas demonstrativas. As rotas `POST /api/products/edit`, `/api/products/status` e `/api/stock/movements` autorizam as operações no servidor. Há controlo de concorrência por revisão/contagem, idempotência por ID de operação e histórico de vendas, compras e devoluções posterior à implementação. A interface mostra operador e motivo dos 20 registos mais recentes. O sistema ainda não foi homologado com equipamentos reais e não substitui documentos fiscais.

## Actualização — Contas e permissões (13/10/2026)
A gestão de colaboradores reais já permite editar nome e perfil, desactivar/reactivar contas e terminar as sessões existentes. O servidor impede a alteração de contas de proprietário e restringe as operações ao negócio do proprietário autenticado. É registado um histórico de alterações por operador. A homologação em dispositivos físicos continua pendente.


## Actualização — Super Admin e comerciantes (13/10/2026)
A administração de comerciantes está ligada ao Node/SQLite: edição de nome comercial, proprietário de referência e contactos, suspensão/reactivação de contas, revogação de sessões, histórico e filtro por estado. A suspensão impede novos logins e preserva dados comerciais. Planos pagos, cobranças e gestão de subscrições continuam pendentes, tal como os testes visuais de campo.
