## Leitor de códigos de barras (modo offline)

O ficheiro `zxing-browser.min.js` é a distribuição UMD original de
[`@zxing/browser`](https://github.com/zxing-js/browser), versão exacta **0.2.1**,
obtida do pacote npm oficial (SHA-1 do pacote: `41ca0b80648d131dec5d8cc18efbd62fae4646e7`).

- Licença: MIT — ver `zxing-LICENSE`.
- É carregado apenas nos navegadores sem `BarcodeDetector` nativo ou quando este falha.
- Permite ler EAN/UPC, Code 128 e QR, entre outros, sem enviar imagens a terceiros.
- O Pronto POS serve o ficheiro no seu próprio domínio e inclui-o na cache do
  service worker quando esta estiver activa; não depende de um CDN externo.

Não substituir por scripts de CDN sem revisão de segurança e compatibilidade.
