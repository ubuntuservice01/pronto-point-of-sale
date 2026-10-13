# Pronto POS

**O seu negócio na palma da mão.** POS geral mobile first da Ubuntu Service, Lda.

## Estado actual — 0.2

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

17 testes de domínio e servidor cobrem quantidades, arredondamento, troco, stock, idempotência, permissões e associação de produtos ao negócio. Sintaxe e build verificados. Teste visual automatizado bloqueado pela ausência de Chromium no ambiente; scanner real, instalação e recarga offline exigem validação num navegador/dispositivo.

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

17 testes passaram, incluindo integração HTTP, cookie, sessão, primeiro acesso, isolamento e venda transaccional. O teste visual continua pendente pela ausência de Chromium neste ambiente.


## Entrega 0.3 — Venda e caixa
- Caixa real no modo autenticado: abrir turno, entradas/retiradas com motivo, fecho e histórico no servidor, isolados por negócio/utilizador/dispositivo.
- Cada nova venda autenticada exige turno aberto; operações são associadas ao turno e o preço, desconto, pagamentos e stock são validados no servidor.
- Descontos fixos em meticais, pagamentos mistos (dinheiro, M-Pesa, e-Mola e transferência), cálculo do troco e comprovativo não fiscal.
- Devolução **integral** por proprietário ou gerente, com motivo e confirmação do reembolso manual, devolvendo unidades ao stock e preservando a venda original.
- Carrinhos suspensos apenas em memória da aba do navegador; perdem-se quando a aba é fechada ou a página recarregada.
- O sistema **não efectua nem confirma automaticamente** cobranças ou reembolsos M-Pesa/e-Mola. É necessária confirmação humana. Não emite nota de crédito fiscal.
- Offline autenticado continua pendente. A nova fase usa a API Node/SQLite já existente, não o Supabase.
- Testes de integração em Node, navegador e equipamento real continuam a ser obrigatórios antes de uso comercial.
