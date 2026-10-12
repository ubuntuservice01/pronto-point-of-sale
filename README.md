# Pronto POS

**O seu negócio na palma da mão.** POS geral mobile first da Ubuntu Service, Lda.

## Estado desta entrega

Primeira versão funcional de **demonstração local**, em português de Moçambique e inglês. Não contém autenticação, servidor multiempresa, credenciais reais ou sincronização remota. A mudança de negócio/perfil serve para explorar as interfaces; não constitui uma fronteira de segurança.

Inclui painel, negócios e colaboradores de demonstração, produtos por unidade/metro/kg/etc., recepção de stock, carrinho, quantidades fraccionadas, pagamentos registados, troco, histórico e comprovativo de demonstração. Vendas e stock são gravados numa transacção IndexedDB; recarregar não apaga as vendas. O carrinho ainda não é persistido.

A câmara usa BarcodeDetector quando disponível, sob HTTPS ou localhost. A confirmação inclui som após interacção, vibração quando disponível e mensagem visual. Há introdução manual e leitores que escrevem o código e enviam Enter. Testes com câmaras e equipamentos físicos ainda são necessários.

O service worker prepara a aplicação para abrir offline após a primeira visita e a instalação do cache. As vendas ficam locais. Ter internet **não** as envia para um servidor nesta versão. Não apagar os dados do navegador: ainda não existem backup remoto ou recuperação. A actualização do cache é versionada em public/sw.js.

## Executar

Node.js 22 ou superior; esta base não exige pacotes externos.

```sh
npm run dev
npm run check
npm test
npm run build
npm run preview
```

Desenvolvimento: http://localhost:5173. Build estático: `dist/`. Servir na raiz do domínio com HTTPS. Os scripts de servidor são apenas para desenvolvimento e pré-visualização.

## Validação

11 testes de domínio cobrem quantidades, arredondamento, troco, stock, idempotência, permissões e associação de produtos ao negócio. Sintaxe e build verificados. Teste visual automatizado bloqueado pela ausência de Chromium no ambiente; scanner real, instalação e recarga offline exigem validação num navegador/dispositivo.

Ver [plano de arquitectura](docs/ARCHITECTURE.md) e [lista de validação](docs/ACCEPTANCE.md).
