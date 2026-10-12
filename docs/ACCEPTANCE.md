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
