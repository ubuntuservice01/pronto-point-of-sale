# Pronto POS — Fase 4: segurança, recuperação de acesso e offline seguro

## Estado de operação
Esta etapa pertence **apenas ao piloto Supabase/PostgreSQL** em `/?mode=supabase`. A demonstração e a operação Node/SQLite permanecem distintas. Não representa uma migração completa de vendas offline.

## Autenticação
- O login tem agora o botão «Esqueceu-se da palavra-passe?» que chama Supabase Auth, sem serviço administrativo secreto no navegador.
- O pedido envia o link para a própria origem com `?mode=supabase&reset-password=1`. É **obrigatório** configurar essa URL, incluindo o domínio definitivo, em Supabase Authentication > URL Configuration > Redirect URLs, além de configurar SMTP e verificar entrega real.
- O link de recuperação suportado nesta fase é o *implicit flow* com `#type=recovery&access_token=...`; a aplicação retira os tokens do URL antes de mostrar o formulário. O novo segredo é enviado só à API Auth com o token de recuperação; a sessão do POS é limpa e o operador inicia sessão de novo. Links PKCE `?code=...` não são tratados nesta implementação e devem ser testados/configurados antes de usar.
- Exigir **mínimo de 12 caracteres** na nova palavra-passe no frontend; a política real deve ser configurada também no Supabase Auth.
- Activar, manualmente, **Leaked Password Protection** na configuração de autenticação: os avisos de segurança indicam que ainda está desactivada.

## Perfis e segurança no PostgreSQL
- A navegação de loja mostra apenas as funcionalidades pertinentes ao perfil, mas a autorização real continua a ocorrer na base de dados por JWT, `pronto_private.member_role`, empresa, licença e filial.
- Uma trigger na tabela `pronto_sales` exige papel `owner` ou `manager` para descontos não nulos. Também impede um operador de forjar outro `seller_id`.
- Verificação em `BEGIN/ROLLBACK`: caixa sem permissão para desconto, proprietário com desconto autorizado, isolamento entre duas empresas, revogação efectiva do utilizador.
- Não armazenar tokens de autenticação, chaves administrativas ou palavras-passe em rascunhos.

## Rascunhos seguros no dispositivo (não são vendas finalizadas)
- O operador escolhe **Guardar rascunho encriptado** e introduz uma **frase de recuperação** com pelo menos 12 caracteres. O browser guarda em `localStorage` apenas um envelope AES-GCM derivado por PBKDF2-SHA256 (250 mil iterações), com sal e IV aleatórios e dados associados à conta/empresa/filial.
- O conteúdo protegido inclui carrinho, quantidades, desconto, método e, se houver envio pendente, o pedido original e a **mesma chave de idempotência**.
- Após recuperar o acesso à internet e efectuar novo login, o operador selecciona a mesma filial e escolhe **Recuperar rascunho**, introduzindo a frase original.
- Para pedido pendente: verificar primeiro no histórico/caixa; se o estado for incerto, escolher **Repetir o mesmo pedido**, nunca criar outro ID. Esta repetição usa o mecanismo de idempotência do PostgreSQL.
- Sem internet, não se abre/fecha caixa, não se cadastra stock e **não se concluem vendas no Supabase**. A aplicação não faz reenvio automático nem promete reservar stock; o servidor confirma sempre o stock/preços actualizados.
- O rascunho é por dispositivo e origem web, não sincronizado entre caixas. Um utilizador sem a frase não consegue desencriptar; se perder a frase ou limpar armazenamento do browser, o rascunho não pode ser recuperado.
- A encriptação de armazenamento local reduz exposição acidental, mas não substitui a segurança do próprio dispositivo, bloqueio de ecrã e controlo de utilizadores. Não usar esta função em computadores partilhados sem políticas de acesso e limpeza.

## Antes de comercialização generalizada (não homologado)
- Backup/restauro: efectuar **restauro real** num projecto temporário isolado, verificar contagem de vendas, pagamentos por método e stock por lote; documentar RPO/RTO e retenção. Ainda **não** foi executado um restauro real neste projecto.
- Recuperação de acesso: configurar SMTP e redirect URLs e testar um link recebido por um colaborador de teste que **já exista**, com consentimento do proprietário, sem afectar a conta Ubuntu Super Admin.
- Carga/concorrência: executar duas sessões de caixa em simultâneo e confirmar bloqueio de stock, validade da licença e consistência de fechos.
- Offline comercial completo exige fila transaccional persistente cifrada, gestão de conflitos, reconciliação por servidor, revisão de preços e lotes, aprovação e sincronização após login válido. **Não incluído nesta fase**.
- Ainda faltam integração de devoluções, dívidas, fotografias no Supabase Storage, vendas em espera partilhadas entre caixas, impressão e conformidade fiscal.
- O aviso `rls_enabled_no_policy` em tabelas privadas/de contadores é intencional; nenhuma escrita directa de utilizador é concedida a essas tabelas. Verificar novamente após futuras migrações.
