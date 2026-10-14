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
