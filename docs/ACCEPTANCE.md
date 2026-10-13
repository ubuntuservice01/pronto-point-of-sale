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
