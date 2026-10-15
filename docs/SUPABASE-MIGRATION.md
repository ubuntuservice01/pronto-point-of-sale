# Pronto POS — migração gradual para Supabase

## Projecto confirmado
- Project ref: `xgtpvszwzvkwysrswkek` (Supabase `prontopos`).
- Public project URL: `https://xgtpvszwzvkwysrswkek.supabase.co`.
- O projecto **não** é `ubuntupos360`, `FARMA360` ou `MobiGest`.
- A chave publishable é uma configuração pública, mas deve ser injectada pelo ambiente de implantação; não guardar chaves administrativas no repositório.

## Estado: fase de fundação, sem cutover
A migração `pronto_pos_core` foi aplicada em 14/10/2026. Criou 21 tabelas `public.pronto_*`, todas com RLS habilitado; elas estão vazias. A tabela `pronto_plans` não tem uma política de leitura pública por escolha de segurança — só o servidor poderá administrá-la. As demais tabelas expõem SELECT condicionado ao vínculo autenticado com a empresa, sem permitir INSERT/UPDATE/DELETE directamente a utilizadores de navegador.

**O código principal do Pronto POS ainda usa Node.js + SQLite no modo autenticado.** A migração prepara o Supabase, mas não torna o frontend ligado a ele. Não publicar uma versão supostamente «migrada» sem adaptar servidor, autenticação e fluxos.

## Próximas fases obrigatórias
1. Definir o modelo de autenticação com Supabase Auth e mapear contas Ubuntu/operadores para `auth.users`; preservar regras de primeira palavra-passe, suspensão e licença. Não migrar hashes de palavras-passe sem estratégia explícita.
2. Implementar a camada de serviço transaccional para operações financeiras e de stock: abertura/fecho de caixa, vendas e pagamentos mistos, idempotência, FEFO por lotes, devoluções, pagamentos de dívida e auditoria. **Nunca permitir a conclusão de vendas como escritas sequenciais feitas pelo browser**.
3. Implementar criação transaccional de empresas, filiais, memberships e primeiro proprietário pelo serviço administrador, com controlo de licenças e sem papel de super-admin forjado no cliente.
4. Migrar o histórico real **somente após** mapear identificadores de negócio/filial, produtos, utilizadores, lotes, vendas, pagamentos e caixa; reconciliação de saldos de stock e total recebido por método; executar migração de ensaio com possibilidade de reversão.
5. Criar políticas de Storage para imagens dos produtos separadas por empresa. Não colocar ficheiros grandes em JSON no PostgreSQL.
6. Testar RLS com dois utilizadores de empresas distintas e operadores dos cinco perfis; confirmar negação explícita de mutações directas.
7. Resolver backups, restauro, domínio HTTPS, monitorização, recuperação de acessos, teste em telemóveis e legislação fiscal antes de comercialização generalizada.
8. Fazer cutover apenas depois de passar a validação funcional e financeira completa; manter o sistema SQLite actual inalterado até lá.

## Variáveis de ambiente
O actual projecto é JavaScript puro / Node, não Next.js; variáveis NEXT_PUBLIC_* não são automaticamente injectadas no bundle. A URL e a chave publicável devem ser carregadas por um módulo de configuração **apenas depois** de o modo Supabase estar implementado. Chaves secret/service-role nunca devem ser enviadas ao navegador.

## Validação inicial
- 21 tabelas próprias, 21 com RLS ligado, 0 registos.
- Migração Supabase: `20261014192010_pronto_pos_core`.
- Security advisor: aviso informativo `rls_enabled_no_policy` exclusivamente para `pronto_plans`, intencional porque nenhum papel de browser recebe acesso ao catálogo de planos.
- O workflow verde de 163 testes do ramo principal refere-se à versão SQLite **anterior** à integração real com Supabase e não valida futuras transacções PostgreSQL.

## Super Administrador Ubuntu Service — identidade global

- A identidade global reside exclusivamente em `pronto_private.ubuntu_super_admins`, com `user_id` referenciado a `auth.users` e uma flag de activação. O e-mail não é usado como permissão de autorização.
- O único mecanismo exposto ao browser é o RPC `public.pronto_admin_status()`, protegido por autenticação e sem parâmetros. Lê a identidade do JWT actual por `auth.uid()` e devolve apenas `true` ou `false`.
- O RPC não permite cadastrar comerciantes, consultar todas as vendas, alterar licenças ou elevar outras contas. Essas operações dependem de APIs administrativas futuras, protegidas no servidor e auditadas.
- A atribuição inicial da conta foi executada separadamente no projecto Supabase depois de confirmar o UID e o e-mail; **não há e-mails nem UUIDs pessoais inseridos nos ficheiros de migração versionados**.
- Na interface isolada `/?auth-check=1`, uma conta com o perfil global activo é reconhecida como «Super Administrador — Ubuntu Service».
- A demonstração estática do Lovable continua separada da autenticação real e o login operacional Node/SQLite ainda não foi migrado.

## Fase 1 — painel administrativo Ubuntu Service (consulta protegida)

- URL de acesso isolado: `/?mode=supabase` ou `/?auth-check=1` (na pré-visualização Lovable, mantenha o token de acesso da pré-visualização).
- Depois de iniciar sessão no Supabase Auth, o perfil global é validado pelo RPC `pronto_admin_status()`. Só o perfil validado é encaminhado ao painel administrativo. Utilizadores comuns permanecem no ecrã de identificação, sem acesso ao painel.
- O RPC `pronto_admin_overview()` é autenticado, de consulta e protegido na base de dados. Lista exclusivamente metadados de empresas, estado das licenças, planos, contagens de filiais e operadores. Não concede acesso aos produtos ou vendas, não disponibiliza movimentos de caixa e não expõe funções de escrita.
- Secções funcionais: **Visão geral**, **Comerciantes**, **Licenças**, **Planos** e **Segurança**. Trocar de secção ou actualizar os dados reconsulta o RPC, permitindo que permissões revogadas deixem de dar acesso.
- Pesquisa local de comerciantes por nome, contacto, plano ou ID, com saída HTML escapada.
- Sessão: acesso e eventual refresh token ficam **apenas na memória da página**; o cliente renova tokens curtos enquanto a página está aberta, termina a sessão ao sair e pede novo login após recarregar a página. Nenhum token é persistido em `localStorage` ou `sessionStorage`.
- Não alterar o modo de demonstração nem o modo Node/SQLite. O cadastro real, alterações, suspensão e atribuição de planos continuam **indisponíveis** até implementação da API transaccional segura com auditoria.
- Estado inicial esperado no Supabase: **zero** comerciantes, **zero** planos. Estes são dados reais; não preencher com exemplos fictícios.
- Testes de browser/móvel e login com palavra-passe da conta real dependem da validação do próprio administrador. Os testes automatizados cobrem o cliente com respostas simuladas; a criação de comerciantes reais e as operações de caixa ainda não foram homologadas.

## Fase 2 — provisionamento comercial no Supabase

- O Super Administrador pode criar comerciantes, planos, licenças e associações de proprietários e operadores em `/?mode=supabase`.
- Todas as alterações passam pelo RPC `public.pronto_admin_mutation`, que exige o UID autorizado, valida os dados, executa cada acção numa transacção e regista auditoria em `pronto_private.admin_actions` e `public.pronto_audit_events` quando há empresa associada.
- Cada empresa e filial principal começam suspensas. O acesso só é permitido quando existir um proprietário activo, uma licença válida e a empresa tiver sido activada. A função `pronto_private.member_role` exige empresa e licença activas.
- A Edge Function `pronto-admin-invite` exige JWT válido, verifica Supabase Auth e o papel global Ubuntu antes de usar a API Admin para enviar um convite. A chave administrativa vive apenas no servidor Supabase.
- Quando o convite é enviado mas a associação falha, recuperar o UID em Supabase Authentication → Users e usar o formulário de associação da conta existente. Não reenviar convites repetidamente.
- Os perfis permitidos são owner, manager, cashier, stock e finance. A conta global Ubuntu Super Admin não pode ser colocada como funcionário de loja.
- A licença é um registo de autorização de serviço, não é uma cobrança M-Pesa/e-Mola.
- Antes de convidar comerciantes reais, configurar SMTP, domínio e URLs de redireccionamento no Supabase Auth.
- O ambiente de ensaio utilizou BEGIN/ROLLBACK. Não foram criados comerciantes ou planos fictícios persistentes.
- O frontend operacional de vendas ainda usa Node/SQLite. Estas operações comerciais de cadastro não activam a escrita de vendas e stock no PostgreSQL. Não anunciar migração financeira completa antes de implementar e testar as transacções de vendas, caixa, stock e dívidas.

## Fase 3 — núcleo de loja Supabase em modo piloto (PostgreSQL)

- A rota `/?mode=supabase` usa Supabase Auth; se a conta for o Super Administrador, abre o painel Ubuntu, e se for um membro com empresa/filial activa e licença válida, abre o **modo piloto de loja**, separado do POS legado.
- Operações implementadas por RPC protegido: `product_create` com código por filial, `stock_receive` com lote, validade e custo, `cash_open`, `cash_close` e `sale_complete` com meios únicos ou repartidos.
- A base calcula os valores a partir dos preços reais dos produtos, não confia nos subtotais do browser. Descontos e pagamentos são validados em cêntimos inteiros; quantidades por artigo têm até três casas decimais.
- Uma venda só é confirmada com a sessão de caixa aberta pelo próprio operador. O registo de venda, artigos, pagamentos, lotes FEFO, baixa de stock e auditoria são efectuados na **mesma transacção PostgreSQL**.
- Cada venda tem uma chave idempotente e hash do pedido. Reenvios idênticos devolvem a referência original, sem duplicar vendas. Se a aplicação ficar sem resposta, mantenha o mesmo pedido para repetir com segurança; não crie nova venda até confirmar o estado.
- O operador confirma manualmente M-Pesa/e-Mola/transferência; ainda não existem webhooks de confirmação dos fornecedores.
- O fecho de caixa reconcilia dinheiro inicial, recebimentos em dinheiro e movimentos do caixa. **Devoluções, dívidas e movimentos de caixa fora de vendas ainda não foram integrados**, pelo que a implementação financeira é parcial.
- Segurança: `pronto_private.member_role` exige empresa activa, membro activo e subscrição válida. As funções com `SECURITY DEFINER` só devolvem dados da empresa/filial do funcionário autenticado; o cliente não dispõe de permissões directas INSERT/UPDATE/DELETE nas tabelas de stock e vendas.
- Os ensaios reais foram executados com uma conta Auth/empresa temporárias dentro de `BEGIN; ... ROLLBACK;`, incluindo: código automático, recepção de lote, pagamento repartido dinheiro/e-Mola, idempotência, rejeição de sobre-venda e reconciliação do caixa. Nenhum artigo, comerciante ou venda fictícios ficaram guardados.
- As contas reais de comerciantes, SMTP de convites, impressão e equipamento, fotografias em Supabase Storage, vendas offline com reconciliação, reservas/vendas em espera sincronizadas, gestão de dívidas, devoluções, relatórios avançados, documentos fiscais e migração de histórico **ainda não foram homologados**.
- A **versão comercial anterior Node.js/SQLite e o modo demonstração não foram substituídos**. Não ligar directamente vendedores reais ao novo modo piloto sem ensaios de carga e de concorrência, backup/restauro, confirmação fiscal e testes E2E no navegador/dispositivos.

## PIN de cinco dígitos e bloqueio de ecrã

- O PIN é definido pelo próprio utilizador **depois de uma autenticação Supabase Auth válida**, no primeiro acesso. Cada comerciante ou colaborador possui um PIN próprio; o proprietário não recebe o PIN dos outros utilizadores.
- O ecrã inicial exige o PIN após login, enquanto existir uma sessão activa; não é uma alternativa para entrar numa sessão encerrada, noutro dispositivo ou após recarregar o navegador. A conta mantém a palavra-passe forte e a recuperação por email. O Super Administrador mantém as mesmas protecções.
- O ecrã bloqueia imediatamente ao a aplicação ficar em segundo plano (`visibilitychange`), ao sair da página (`pagehide`) ou após **3 minutos** sem actividade. Existe um botão **Bloquear** e opção **Alterar PIN**.
- O ecrã de bloqueio oculta os dados e impede novas interacções de UI com a aplicação. O carrinho e pedidos pendentes continuam na memória da sessão enquanto a página não for encerrada. Após fechar o separador ou o navegador, é obrigatório autenticar novamente; rascunhos persistentes são geridos pelo módulo encriptado existente.
- Os PINs são verificados pelo RPC autenticado `public.pronto_session_pin`; a tabela privada guarda **bcrypt (`crypt`, custo 12)**, nunca PINs visíveis. Cinco tentativas erradas provocam bloqueio de **15 minutos** por conta. O número de tentativas é actualizado no servidor com bloqueio transaccional.
- O PIN **não desbloqueia acessos a APIs financeiras por si só** e não substitui Supabase Auth. O bloqueio de ecrã protege a interface e impede chamadas do cliente oficial enquanto bloqueado; para ambientes partilhados ou de alto risco, o controlo tem de evoluir para uma sessão de caixa/dispositivo com validação de desbloqueio no servidor em todas as operações críticas.
- A criação dos colaboradores pelo comerciante passa a estar disponível no menu **Colaboradores** para o perfil **proprietário**. O proprietário pode convidar funções de caixa, gerente, stock e financeiro através da Edge Function `pronto-owner-invite`, que só envia email após verificar o papel de proprietário na empresa. A associação é auditada no RPC `pronto_owner_assign_staff`. Não se atribuem PINs a terceiros nem perfis de novo proprietário.
- Pré-requisitos externos: confirmar SMTP e redireccionamentos de convite no Supabase Auth. O convite por email e a experiência em dispositivos reais exigem homologação com contas reais; a nova modalidade não significa que o POS inteiro já esteja pronto para comercialização.

## Bloco de lançamento 1–10 — Clientes, Dívidas e Cobranças (2026-10-15)

- Migração versionada `20261015180000_pronto_customer_credit.sql` aplicada ao projecto existente `prontopos` (`xgtpvszwzvkwysrswkek`). Define clientes, crédito, dívida, lançamentos, cobranças idempotentes e RPC autenticada `pronto_credit_snapshot`. Não permitir escrita directa pelo browser em tabelas financeiras.
- `src/supabase-credit-ui.js`: clientes e pesquisa, formulário de crédito/limite, dívida/vencimento, cobrança parcial, histórico, extracto imprimível não fiscal, lembrete WhatsApp iniciado por clique e avisos de dívidas vencidas.
- `src/supabase-shop-ui.js` inclui identificação de cliente na venda paga e opção «Vender a crédito». O servidor valida caixa aberto, cliente, limite, lotes FEFO, preço, concorrência, idempotência, permissões e auditoria, gravando venda, stock e dívida na mesma transacção.
- Cobranças requerem caixa aberto e confirmação manual dos recebimentos por dinheiro/M-Pesa/e-Mola/transferência. Não há confirmação por prestador financeiro.
- O cliente mantém referência do pagamento com resposta incerta para evitar que nova tentativa gere cobrança com identificador diferente; verificar histórico antes de repetir.
- O novo fluxo continua piloto enquanto faltarem testes de concorrência, equipamentos reais, restauro, dados reais e requisitos fiscais. Não anunciar facturação certificada.
