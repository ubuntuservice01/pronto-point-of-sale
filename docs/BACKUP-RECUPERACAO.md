# Pronto POS — cópias de segurança e recuperação

## Estado e âmbito

- Projecto Supabase: `prontopos`, referência `xgtpvszwzvkwysrswkek`, PostgreSQL 17, organização Ubuntu Service no plano **Pro** (confirmado em 21/10/2026).
- O plano Pro inclui cópias de segurança diárias geridas pelo Supabase e até **7 dias de pontos de recuperação**. Conferir as cópias efectivamente disponíveis em **Supabase Dashboard → Database → Backups**.
- O acesso a vendas antigas na aplicação não tem relação com o prazo de 7 dias: esse prazo aplica-se às versões *restauráveis da base*, não à idade das vendas consultáveis.
- **Não foi executado restauro real** num projecto isolado. O ponto 93 do roadmap continua pendente.
- **Não foi confirmada a activação** do segundo backup remoto. A rotina incluída neste repositório está desactivada até completar a configuração indicada abaixo.

Documentação: https://supabase.com/docs/guides/platform/backups

## Segunda cópia encriptada, fora do Supabase

O workflow `.github/workflows/pronto-backup.yml` está programado para 01:15 UTC (03:15 em Moçambique), mas só executa com `PRONTO_BACKUP_ENABLED=true`. Usa o PostgreSQL 17 para uma cópia lógica consistente dos esquemas da aplicação `public` e `pronto_private`, valida a presença das tabelas comerciais essenciais, encripta o arquivo com **age**, envia apenas o arquivo cifrado e um SHA-256 para um bucket S3 independente e confirma que o objecto existe e não está vazio.

**Atenção:** esta segunda cópia abrange apenas os esquemas indicados. Não substitui as cópias completas geridas pelo Supabase, nem inclui ficheiros da Supabase Storage (fotografias/documentos), utilizadores de Auth ou toda a configuração de infra-estrutura. Devem existir cópias e procedimentos separados para esses elementos.

### Configuração no GitHub

Repositório → **Settings → Secrets and variables → Actions**.

Criar os seguintes **Secrets**:

| Nome | Valor esperado |
|---|---|
| `PRONTO_BACKUP_DATABASE_URL` | URL PostgreSQL do projecto para `pg_dump`, com acesso a **todas as empresas** (incluindo `BYPASSRLS`), por exemplo a conta administrativa `postgres`, e ligação TLS (`sslmode=require`). Uma conta sujeita a RLS gera cópias incompletas e é rejeitada pela rotina |
| `PRONTO_BACKUP_S3_ACCESS_KEY_ID` | ID de acesso a bucket independente |
| `PRONTO_BACKUP_S3_SECRET_ACCESS_KEY` | Chave secreta com permissão limitada de escrita/consulta no prefixo dos backups |

Criar as seguintes **Variables**:

| Nome | Valor esperado |
|---|---|
| `PRONTO_BACKUP_AGE_RECIPIENT` | Chave **pública** `age1...` criada por um administrador |
| `PRONTO_BACKUP_S3_BUCKET` | Nome do bucket S3 independente, de preferência privado e com versionamento |
| `PRONTO_BACKUP_S3_REGION` | Região do bucket, por exemplo `eu-west-1` |
| `PRONTO_BACKUP_S3_ENDPOINT` | URL HTTPS do serviço S3 compatível; deixar vazia para AWS S3 |
| `PRONTO_BACKUP_ENABLED` | Iniciar em `false`; mudar para `true` **após** o teste manual de execução e de restauração |

Gerar o par de chaves numa máquina controlada:

```bash
age-keygen -o pronto-backup-identity.txt
age-keygen -y pronto-backup-identity.txt
```

Guardar **a chave privada** (`pronto-backup-identity.txt`) num cofre seguro e numa segunda localização de recuperação, fora do GitHub e do Supabase. O GitHub recebe **só a chave pública** gerada pelo segundo comando. Sem a chave privada os backups encriptados não são recuperáveis.

Configurar no bucket uma política de retenção (exemplo: 90 cópias diárias e 12 cópias mensais), versionamento/imutabilidade quando disponível, alarmes de falha e acesso restrito. **A rotina não elimina cópias antigas**: a retenção deve ser feita por lifecycle no bucket, depois de verificar requisitos legais e comerciais.

### Activação segura

1. Confirmar os pontos existentes em **Database → Backups** no Supabase; registar data/hora do último backup.
2. Preparar bucket externo privado, chaves age, Secrets/Variables. Nunca introduzir a chave privada no GitHub nem na aplicação web.
3. Executar manualmente **Actions → Pronto POS - Backup independente → Run workflow** com a variável de activação temporariamente `true`; rever apenas o resultado, não imprimir segredos. A chave PostgreSQL concede leitura entre empresas e deve permanecer exclusivamente nos Secrets protegidos.
4. Confirmar no bucket que o ficheiro `.dump.age` e o respectivo `.sha256` existem e que a verificação de integridade funciona.
5. **Fazer um ensaio de restauração apenas num PostgreSQL/Supabase de teste isolado**, previamente preparado com dependências e esquemas necessários. Nunca restaurar sobre o projecto de produção para testar. Comparar contagens de vendas, pagamentos por método, stock por produto/lote e dívidas com uma consulta de origem datada.
6. Apenas após o ensaio de restauração satisfatório manter `PRONTO_BACKUP_ENABLED=true` para a agenda diária. Registar RPO, RTO, responsáveis e resultado mensal do ensaio.

### Desencriptar e verificar uma cópia (ambiente de testes)

```bash
sha256sum -c pronto-AAAAMMDDTHHMMSSZ.dump.age.sha256
age -d -i pronto-backup-identity.txt -o snapshot.dump pronto-AAAAMMDDTHHMMSSZ.dump.age
pg_restore --list snapshot.dump
```

O arquivo `.dump` está em texto binário PostgreSQL (`pg_dump -Fc`); após examinar o inventário com `pg_restore --list`, restaurar apenas num ambiente temporário de teste apropriado. **Nunca lançar `pg_restore` contra a base de produção sem um plano formal e autorização específica.**

## Histórico e exportação pelo comerciante

- **Relatórios → De / Até → Actualizar relatórios** consulta vendas confirmadas por intervalo de datas e filial, sujeitas às permissões do utilizador.
- **Exportar relatório CSV** disponibiliza um resumo financeiro/operacional; não é backup integral da base e não contém necessariamente todas as linhas de transacções.
- Guardar a base na nuvem não implica que um rascunho offline esteja sincronizado. Rascunhos locais ainda requerem reconexão e confirmação da venda.
- Para documentos PDF, no navegador pode ser utilizada a funcionalidade **Imprimir → Guardar como PDF**; uma opção dedicada na interface requer implementação e testes próprios.

## Critérios de aprovação comercial

- [x] Base em Supabase Pro; rotina de backup diário do fornecedor documentada.
- [x] Código da segunda cópia cifrada e verificação estrutural preparado no GitHub.
- [ ] Comprovar pelo Dashboard que há um ponto de recuperação diário válido.
- [ ] Configurar e activar bucket externo e segredos sem publicar credenciais.
- [ ] Confirmar ficheiro offsite real, descodificação e SHA-256.
- [ ] **Restaurar num projecto de teste isolado e reconciliar totais** (roadmap ponto 93).
- [ ] Definir cópias independentes de ficheiros Storage, Auth e configuração.
- [ ] Testar falhas de agendamento/alerta e documentar prazo real de recuperação.
