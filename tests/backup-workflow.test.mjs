import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const script = new URL('../scripts/backup-offsite.sh', import.meta.url);
const workflow = new URL('../.github/workflows/pronto-backup.yml', import.meta.url);

test('backup script enables strict shell mode and rejects RLS-filtered data', () => {
  const content = readFileSync(script, 'utf8');
  assert.match(content, /set -Eeuo pipefail/);
  assert.match(content, /rolbypassrls/);
  assert.match(content, /age -r/);
  assert.match(content, /s3api head-object/);
});

test('backup refuses to run without security credentials', () => {
  const result = spawnSync('bash', [script.pathname], {
    env: {PATH: process.env.PATH}, encoding: 'utf8'
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PRONTO_BACKUP_DATABASE_URL/);
});

test('backup validates project reference before touching the database', () => {
  const env = {
    PATH: process.env.PATH,
    PRONTO_BACKUP_DATABASE_URL: 'postgresql://postgres:secret@some-other-project.example.com/postgres',
    PRONTO_BACKUP_AGE_RECIPIENT: 'age1test',
    PRONTO_BACKUP_S3_BUCKET: 'encrypted-backups',
    PRONTO_BACKUP_EXPECTED_PROJECT_REF: 'xgtpvszwzvkwysrswkek',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_DEFAULT_REGION: 'eu-west-1'
  };
  const result = spawnSync('bash', [script.pathname], {env, encoding: 'utf8'});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /não corresponde/);
  assert.doesNotMatch(result.stderr, /secret/);
});

test('scheduled workflow is gated and does not publish database artifacts', () => {
  const content = readFileSync(workflow, 'utf8');
  assert.match(content, /PRONTO_BACKUP_ENABLED == 'true'/);
  assert.match(content, /cron:/);
  assert.match(content, /secrets.PRONTO_BACKUP_DATABASE_URL/);
  assert.doesNotMatch(content, /upload-artifact/);
});
