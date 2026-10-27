# Pronto POS — Fase 7: protocolo de homologação farmacêutica

**Estado:** validação técnica automatizada, NÃO homologado comercialmente.
Em 27/10/2026, o Supabase tinha zero estabelecimentos classificados como Farmácia e zero profissionais validados.

## Antes do piloto real

- [ ] Estabelecimento autorizado a operar, com documentação verificada fora do Pronto POS.
- [ ] Profissional responsável habilitado e registado manualmente pelo Super Administrador.
- [ ] Contas distintas para proprietário, vendedor e responsável técnico; sem credenciais partilhadas.
- [ ] Ambiente de ensaio, sem pacientes ou pagamentos reais; PIN e sessão em dois dispositivos.
- [ ] Confirmar sincronização do commit no Lovable e actualizar a PWA.

## Casos que devem passar, com evidências

| ID | Cenário | Critério |
|---|---|---|
| P01 | Cadastro do medicamento | Princípio activo, apresentação e receita persistem |
| P02 | Recepção com lote e validade | Entrada controlada e auditada |
| P03 | Lote ausente/vencido/incoerente | Recusa sem alterar stock |
| P04 | Venda FEFO | Primeiro lote válido mais próximo do vencimento |
| P05 | Venda Rx sem autorização | Recusa, sem pagamento ou baixa |
| P06 | Aprovação por não habilitado | Recusa no servidor |
| P07 | Aprovação por habilitado | Referência, quantidade, vendedor e filial vinculados |
| P08 | Alteração do carrinho ou vendedor | Aprovação não pode ser reutilizada |
| P09 | Pedido vencido ou duplicado | Idempotência e prazo respeitados |
| P10 | Pagamento misto e troco | Totais conciliados |
| P11 | Devolução de medicamento | Reembolso sem reentrada automática em stock de venda |
| P12 | Bloquear lote | Impede venda e nova recepção do lote |
| P13 | Bloqueio durante transporte | Destino não recebe lote bloqueado |
| P14 | Mesmo lote noutra filial | Venda impedida quando código e lote coincidem |
| P15 | Desbloqueio justificado | Apenas responsável autorizado; lote não vencido |
| P16 | Data local de Moçambique | Vencido hoje é recusado |
| P17 | Rastreabilidade | CSV sem dados identificáveis do paciente |
| P18 | Outra empresa/conta sem vínculo | Acesso negado por RLS e RPC |
| P19 | Internet fraca e PWA | Não duplica venda nem autorização |
| P20 | Farmácia piloto real | Aceitação assinada pelo responsável técnico |

## Critérios de bloqueio

**Nunca lançar** se for possível vender lote vencido ou em quarentena,
dispensar Rx sem autorização, reutilizar aprovação, repor medicamento devolvido
no stock vendável ou consultar dados de outra empresa.

A homologação exige evidências por cenário: data, dispositivo, versão de commit,
responsável, resultado, auditoria e assinatura. Testes automáticos e SQL
transaccionais não substituem licenciamento nem ensaios reais supervisionados.

## Procedimento técnico

1. Executar npm run check, npm test e npm run build.
2. Executar o script tests/sql/pharmacy-pilot-transaction.sql em ambiente de
   teste ou sessão controlada; o script inicia BEGIN e termina ROLLBACK.
3. Nunca retirar ROLLBACK nem gravar vendas fictícias na base real.
4. Confirmar a versão publicada e actualizar cache PWA.
5. Só activar o piloto real com o responsável técnico e conformidade verificados.
