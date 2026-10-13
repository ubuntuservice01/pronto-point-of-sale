# Pronto POS — Roteiro de validação manual (versão 0.5)

## Objectivo
Validar a aplicação em dispositivos reais **sem** confundir o modo de demonstração local com o modo autenticado Node/SQLite. Registar falhas e não avançar para produção enquanto os fluxos de venda, caixa e permissões críticas não estiverem aprovados.

| ID | Cenário | Critério de aprovação | Resultado |
|---|---|---|---|
| QA-01 | Android 360 px — entrada, menus, navegação Mais | Todas as páginas permitidas são alcançáveis, sem cortes ou botões sobrepostos | Pendente |
| QA-02 | Desktop e tablet — gestão comercial | Clientes, compras, despesas e relatórios abrem e guardam sem erros | Pendente |
| QA-03 | Caixa real autenticado | Abertura, entrada, retirada, fecho e reabertura persistem após reload | Pendente |
| QA-04 | Venda sem caixa aberto | Sistema impede a venda e indica como abrir o turno | Pendente |
| QA-05 | Venda cash e pagamento repartido | Troco, stock, subtotal, desconto autorizado e recibo estão correctos | Pendente |
| QA-06 | Stale cart | Produto inactivo/sem stock não provoca crash nem venda indevida | Pendente |
| QA-07 | Devolução integral | Só proprietário/gerente pode processar, com confirmação do reembolso manual | Pendente |
| QA-08 | Isolamento entre comerciantes | Nenhum negócio recebe dados ou registos de outro | Pendente |
| QA-09 | Operador de caixa | Não vê custo de aquisição nem altera descontos, despesas ou stocks | Pendente |
| QA-10 | Responsável de stock | Regista compras, mas não vê caixas ou movimentos financeiros | Pendente |
| QA-11 | Filtros de histórico | Pesquisa e datas não afectam o registo original | Pendente |
| QA-12 | Exportação CSV no Excel | Acções não executam fórmulas; textos com aspas ficam correctos | Pendente |
| QA-13 | Impressão/PDF no computador | Comprovativo e relatório não fiscal têm margens, total e nomes legíveis | Pendente |
| QA-14 | Impressora térmica 58 mm e 80 mm | Texto não corta e valores não desaparecem | Pendente |
| QA-15 | Leitura de código físico | Teclado/leitor e câmara identificam artigo uma única vez por leitura | Pendente |
| QA-16 | Internet desligada durante venda autenticada | Não confirma venda local sem servidor nem apresenta falso sucesso | Pendente |
| QA-17 | Dois operadores em simultâneo | Não vendem mais quantidade do que o stock real | Pendente |
| QA-18 | Repetição da mesma operação após falha de rede | Idempotência evita duplicar vendas, compras e despesas | Pendente |
| QA-19 | Instalação PWA e reabertura | Sem erro de cache, conteúdo actualizado e demonstração acessível | Pendente |
| QA-20 | Sessão expirada e logout | Pede novo login sem divulgar dados privados no navegador | Pendente |

## Procedimento
Em cada execução, registar data, perfil, dispositivo, browser, ID do cenário, resultado (aprovado/reprovado), passos para reproduzir e capturas de ecrã quando relevantes.

## Limites funcionais conhecidos
- Modo autenticado exige acesso à API; não há sincronização offline autenticada.
- A demo IndexedDB não oferece segurança de autenticação nem separação forte de utilizadores.
- Reembolsos M-Pesa/e-Mola e documentos fiscais não são efectuados automaticamente.
- Alguns endpoints de edição de produto e membros permanecem pendentes.
- O relatório de margem é parcial e não equivale a lucro líquido.
- O fluxo de venda suspensa não persiste após fechar a aba.

## Gates para produção
1. `npm run check`, `npm test` e `npm run build` sem falhas, preferencialmente com GitHub Actions verde no commit a implantar.
2. Concluir cenários QA-01 a QA-20 e documentar quaisquer excepções aceites.
3. Confirmar backups, HTTPS, retenção, recuperação operacional e política de permissões.
4. Validar exigências legais e fiscais aplicáveis antes de vender o serviço como sistema de facturação.


## Novos cenários Super Admin — Fase 0.8
| ID | Cenário | Critério | Resultado |
|---|---|---|---|
| QA-21 | Super Admin edita nome e contactos de um negócio | Dados são guardados após reload, sem alterar o login do proprietário | Pendente |
| QA-22 | Super Admin suspende negócio com duas sessões do proprietário e um operador | Todos deixam de operar e não conseguem voltar a entrar até à reactivação | Pendente |
| QA-23 | Suspensão com negócio com stock e vendas | Inventário e histórico permanecem intactos | Pendente |
| QA-24 | Reactivação de negócio suspenso | Contas podem iniciar novas sessões com palavras-passe existentes | Pendente |
| QA-25 | Utilizador de outro negócio tenta alterar ou suspender empresa | A API devolve 403/404 e não altera registos | Pendente |
| QA-26 | Dois administradores editam simultaneamente | O segundo pedido desactualizado obtém conflito 409 e actualiza o ecrã | Pendente |
| QA-27 | Filtrar negócios activos/suspensos no telemóvel | Filtros e botões não ficam ocultos nem sobrepostos | Pendente |
