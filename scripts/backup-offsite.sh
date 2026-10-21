#!/usr/bin/env bash
# Pronto POS: encrypted, off-site logical backup of application-owned PostgreSQL schemas.
# Never run this script with GitHub Actions debug logging enabled: the database URL is a secret.
set -Eeuo pipefail

need() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    printf 'Backup não configurado: falta %s.\n' "$name" >&2
    exit 2
  fi
}

for name in PRONTO_BACKUP_DATABASE_URL PRONTO_BACKUP_AGE_RECIPIENT \
  PRONTO_BACKUP_S3_BUCKET PRONTO_BACKUP_EXPECTED_PROJECT_REF \
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION; do
  need "$name"
done

if [[ "$PRONTO_BACKUP_DATABASE_URL" != *"$PRONTO_BACKUP_EXPECTED_PROJECT_REF"* ]]; then
  printf 'A ligação não corresponde ao projecto Supabase esperado.\n' >&2
  exit 2
fi
if [[ "$PRONTO_BACKUP_AGE_RECIPIENT" != age1* ]]; then
  printf 'Destinatário age inválido: é necessária uma chave pública age1...\n' >&2
  exit 2
fi
if [[ -n "${PRONTO_BACKUP_S3_ENDPOINT:-}" && "$PRONTO_BACKUP_S3_ENDPOINT" != https://* ]]; then
  printf 'O destino S3 deve usar HTTPS.\n' >&2
  exit 2
fi

for command in docker age aws sha256sum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Dependência em falta: %s.\n' "$command" >&2
    exit 2
  fi
done

backup_dir="$(mktemp -d)"
chmod 700 "$backup_dir"
cleanup() {
  # All plaintext artefacts remain only on the temporary runner and are removed at exit.
  rm -f "$backup_dir/snapshot.dump" "$backup_dir/snapshot.list" \
    "$backup_dir/snapshot.dump.age" "$backup_dir/snapshot.dump.age.sha256"
  rmdir "$backup_dir" 2>/dev/null || true
}
trap cleanup EXIT

export PRONTO_BACKUP_DATABASE_URL
docker run --rm --network host \
  --env PRONTO_BACKUP_DATABASE_URL \
  --mount "type=bind,source=$backup_dir,target=/backup" \
  postgres:17-alpine sh -euc '
    # A role subject to RLS can silently back up only one tenant: reject it.
    can_read_all="$(psql "$PRONTO_BACKUP_DATABASE_URL" -XAtqc \
      "select case when rolsuper or rolbypassrls then 1 else 0 end from pg_roles where rolname = current_user")"
    if [ "$can_read_all" != 1 ]; then
      echo "A função PostgreSQL de backup não consegue copiar todas as empresas (RLS)." >&2
      exit 1
    fi
    pg_dump --dbname="$PRONTO_BACKUP_DATABASE_URL" --format=custom \
      --no-owner --no-acl --schema=public --schema=pronto_private \
      --file=/backup/snapshot.dump
    pg_restore --list /backup/snapshot.dump > /backup/snapshot.list
  '

# Fail closed if the backup does not contain essential application tables.
for table in pronto_sales pronto_sale_items pronto_payment_allocations pronto_stock_movements; do
  if ! grep -Eq " TABLE public ${table} " "$backup_dir/snapshot.list"; then
    printf 'Cópia incompleta: tabela %s não encontrada.\n' "$table" >&2
    exit 1
  fi
done

age -r "$PRONTO_BACKUP_AGE_RECIPIENT" \
  -o "$backup_dir/snapshot.dump.age" "$backup_dir/snapshot.dump"
test -s "$backup_dir/snapshot.dump.age"

pushd "$backup_dir" >/dev/null
sha256sum snapshot.dump.age > snapshot.dump.age.sha256
popd >/dev/null

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
object_key="pronto-pos/app-db/${stamp:0:4}/${stamp:4:2}/pronto-${stamp}.dump.age"
aws_args=()
if [[ -n "${PRONTO_BACKUP_S3_ENDPOINT:-}" ]]; then
  aws_args+=(--endpoint-url "$PRONTO_BACKUP_S3_ENDPOINT")
fi

# Never upload unencrypted dumps, raw SQL, logs, or secrets to Actions artifacts.
aws "${aws_args[@]}" s3 cp "$backup_dir/snapshot.dump.age" \
  "s3://$PRONTO_BACKUP_S3_BUCKET/$object_key" \
  --no-progress
aws "${aws_args[@]}" s3 cp "$backup_dir/snapshot.dump.age.sha256" \
  "s3://$PRONTO_BACKUP_S3_BUCKET/${object_key}.sha256" \
  --no-progress

remote_size="$(aws "${aws_args[@]}" s3api head-object \
  --bucket "$PRONTO_BACKUP_S3_BUCKET" --key "$object_key" \
  --query ContentLength --output text)"
if [[ ! "$remote_size" =~ ^[0-9]+$ ]] || (( remote_size <= 0 )); then
  printf 'Erro ao confirmar a cópia encriptada no destino remoto.\n' >&2
  exit 1
fi
printf 'Backup encriptado confirmado no armazenamento independente: %s (%s bytes).\n' \
  "$object_key" "$remote_size"
