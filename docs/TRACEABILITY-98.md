# Mapa de rastreabilidade — Pronto POS (16/10/2026)

## Origem e limites da contagem

**Este relatório não é a lista original dos 92/98 pontos.** Não foi localizada no repositório uma especificação integral de 92 ou 98 itens com numeração individual. Atribuir um número de progresso com base em commits ou títulos de funcionalidades seria inventar dados. O repositório mantém, em contrapartida, um roteiro de **67 cenários QA numerados**, em `docs/QA-MANUAL.md`, que é um conjunto diferente da auditoria de 98 pontos.

**Número exacto da correcção 1–98 em curso: NÃO VERIFICADO.**
**Itens 1–98 individualmente verificados contra a lista original: 0/98.** Isto não significa que não existam funcionalidades concluídas; significa que ainda falta a especificação de referência para fazer essa comparação.

## Fonte de verdade para o trabalho

- Repositório: `ubuntuservice01/pronto-point-of-sale`, branch `main`.
- Estado consultado: commit `ed7929ad7629523ca0aa9f054b01909ba7a99d84`.
- Roteiro manual: `docs/QA-MANUAL.md`: IDs QA-01 a QA-67, todos assinalados como `Pendente` no documento.
- Registo de funcionalidades e limites: `docs/ACCEPTANCE.md`, `README.md`, `docs/FRONTEND-AUDIT.md`.
- Evidência automatizada: workflow `38892975477` aprovado no commit acima.
- A aprovação automática **não** muda o resultado dos cenários de homologação manual para `Aprovado`.

## Grupos dos 67 cenários QA (sem renumerar a auditoria 1–98)

| Faixa QA | Área | Cenários | Homologação manual documental |
| --- | --- | ---: | --- |
| QA-01–20 | Fluxos principais e equipamentos | 20 | Pendente |
| QA-21–27 | Super Admin e suspensão | 7 | Pendente |
| QA-28–37 | Planos, licenças e renovação | 10 | Pendente |
| QA-38–45 | Lotes e FEFO | 8 | Pendente |
| QA-46–55 | Gestão de dívidas | 10 | Pendente |
| QA-56–67 | Alertas, compras e dispositivos | 12 | Pendente |
| **Total** | | **67** | **67 pendentes** |

## Funcionalidades demonstradas por implementação e testes automatizados

| Área | Evidência no código | Estado documentável |
| --- | --- | --- |
| Produtos, inventário, lotes e validade | `src/inventory.js`, `src/batches.js`, `src/supabase-inventory-ui.js`, migrações `supabase/migrations/` | Implementação presente; homologação pendente |
| Vendas e caixa | `src/cash.js`, `src/supabase-shop-dashboard.js`, migrações de caixa | Implementação presente; teste operacional real pendente |
| Dívidas e pagamentos | `src/debts.js`, `src/supabase-credit-core.js`, migrações de crédito | Implementação presente; integração automática de carteiras móveis não demonstrada |
| Filiais e transferências | `src/supabase-transfers-ui.js`, migrações de filiais e transferências | Implementação presente; homologação multi-filial pendente |
| Colaboradores e auditoria | `src/supabase-team-management-ui.js`, `src/supabase-audit-ui.js` | Implementação presente; confirmação de isolamento e sessões reais pendente |
| Recuperação excepcional de caixa | `src/supabase-staff-cash-ui.js`, `src/supabase-identity.js`, `tests/supabase-suspended-cash.test.mjs` | Código, testes e CI aprovados; contagem física e validação real pendentes |
| Offline | `public/sw.js`, `src/offline.js` | Cache/demo offline existente; sincronização autenticada segura não comprovada |
| Relatórios | `src/supabase-reports-ui.js`, `src/supabase-finance-ui.js` | Implementação presente; exactidão fiscal/contabilística não homologada |

## Riscos e trabalho por verificar antes de produção

1. **Isolamento de dados**: testar empresa A versus empresa B, diferentes filiais e perfis, incluindo requisições REST/RPC forjadas.
2. **Concorrência e idempotência**: duas caixas, vendas, stock, transferências, créditos e reconciliações simultâneos com interrupção de rede.
3. **Segurança de sessões**: suspensão/reactivação real, revogação, PIN e recuperação de acesso em múltiplos aparelhos.
4. **Persistência e recuperação**: backups restaurados e testados, políticas de retenção, recuperação operacional.
5. **Offline autenticado**: não prometer venda offline com sincronização até existir fila transaccional segura testada.
6. **Meios electrónicos**: M-Pesa/e-Mola/transferência com integração e reconciliação reais; actualmente não presumir confirmação automática.
7. **Fiscalidade e impressão**: documentação fiscal aplicável, 58/80 mm, scanner e testes reais Android/iOS.
8. **Documentação de aceitação**: reunir evidência para cada cenário QA antes de alterar o estado `Pendente`.

## Regra obrigatória para a contagem dos 98 pontos

Para cada item **original**: guardar `N.º | Texto integral original | Ficheiros/commits | Teste/resultado | Estado (não iniciado / parcial / implementado / homologado) | Observação`. Não substituir esta numeração por QA-01...QA-67. Não inferir conclusão apenas de existência de ficheiro ou CI verde. Quando a lista original for recuperada, preencher a matriz ponto a ponto e actualizar a contagem sem renumerar.
