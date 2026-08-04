# Backup e restauração do MongoDB

Este procedimento protege os dados financeiros do Crelith Finance sem depender
de backup pago do MongoDB Atlas. O Atlas Free não oferece snapshots nativos; por
isso a aplicação usa `mongodump` e `mongorestore`, conforme a recomendação oficial
do MongoDB.

## Política

- Frequência: diariamente às 03:17 UTC e sob demanda.
- Retenção: 30 dias no GitHub Actions.
- Criptografia: OpenPGP simétrico com AES-256 antes do upload.
- Isolamento: a credencial de backup deve ser exclusiva e somente leitura.
- Teste: todo backup é restaurado no banco efêmero `crelith_restore_test`.
- Sucesso: o restore precisa terminar sem erro e conter ao menos uma coleção e
  um documento.
- Falha: o workflow fica vermelho e o backup não pode ser considerado válido.

O artefato contém somente o arquivo criptografado, o manifesto com SHA-256 e o
relatório de contagens da restauração. Nenhum documento financeiro é escrito nos
logs ou no relatório.

## Secrets obrigatórios no GitHub

Em **Settings > Secrets and variables > Actions**, cadastre:

| Secret | Conteúdo |
|---|---|
| `MONGODB_URI_BACKUP` | URI de um usuário Atlas exclusivo para backup e leitura |
| `MONGODB_DATABASE` | Nome do banco de produção, atualmente `aura_finance` |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Frase aleatória com pelo menos 32 caracteres |

Não reutilize `MONGO_URL` do Render. A credencial da aplicação possui permissão
de escrita; a do backup não deve possuir.

Crie a passphrase com um gerador criptográfico, por exemplo
`openssl rand -base64 48`, e guarde-a em um gerenciador de senhas fora do
GitHub. Não reutilize senha pessoal, senha do Atlas ou segredo da aplicação.
Sem essa cópia externa, um backup criptografado não pode ser recuperado.

## Modelo de ameaça do artefato

Este repositório é público. Trate o artefato do GitHub Actions como se terceiros
pudessem obter uma cópia do arquivo criptografado. Por isso:

- nenhum dump descriptografado pode sair do diretório temporário do runner;
- a passphrase precisa ser longa, aleatória, exclusiva e armazenada fora do
  GitHub;
- somente o arquivo criptografado, seu manifesto e a evidência sem dados
  financeiros podem ser publicados como artefato;
- qualquer suspeita de exposição da passphrase exige rotação imediata e criação
  de um novo backup com a nova chave;
- acesso de escrita ao repositório deve ser limitado, pois alterações maliciosas
  no workflow poderiam tentar exfiltrar os secrets na execução seguinte.

O GitHub é a cópia externa ao provedor do banco, não a custódia da chave. O
controle só é válido enquanto dados e chave permanecerem separados.

O GitHub Actions precisa alcançar o Atlas. Restrinja a Network Access sempre que
o plano e a infraestrutura permitirem. Se o cluster estiver liberado para toda a
internet, a credencial exclusiva, senha forte e privilégio mínimo tornam-se gates
obrigatórios, mas não eliminam o risco da allowlist ampla.

## Primeira ativação e evidência

1. Cadastre os três secrets.
2. Abra **Actions > Production database backup > Run workflow**.
3. Confirme que o job `Encrypted backup and isolated restore drill` ficou verde.
4. Baixe o artefato e guarde a passphrase separadamente.
5. Abra `restore-report.json` e registre data, duração, quantidade de coleções e
   documentos na tabela abaixo.

| Data UTC | Workflow/run | Resultado | Duração | Coleções | Documentos | Responsável |
|---|---|---|---|---:|---:|---|
| Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente |

Enquanto essa linha continuar como `Pendente`, o controle está implementado,
mas o P0.1 ainda não está validado em produção.

## Recuperação de desastre

Nunca restaure diretamente sobre produção como primeira tentativa.

1. Interrompa as escritas na aplicação.
2. Identifique o último workflow verde e baixe o artefato.
3. Confirme o SHA-256 do arquivo criptografado com o manifesto.
4. Restaure primeiro em um cluster/banco separado.
5. Valide usuários, contas, lançamentos, recorrências, parcelas, recebíveis,
   metas e configurações.
6. Registre o ponto de recuperação, quem autorizou e o resultado.
7. Somente então planeje a troca da aplicação para o banco restaurado.
8. Preserve o banco antigo até o aceite funcional final.

O script `mongodb_restore_drill.sh` recusa qualquer destino cujo nome não termine
em `_restore_test`. Essa trava é proposital: recuperação real de produção exige
um plano explícito, revisão humana e uma ferramenta separada, não a remoção
apressada de uma proteção.

## Execução local de teste

Pré-requisitos: MongoDB Database Tools, `mongosh`, GnuPG e Python 3.

```bash
export MONGODB_URI_BACKUP='mongodb+srv://...'
export MONGODB_DATABASE='aura_finance'
export BACKUP_ENCRYPTION_PASSPHRASE='frase-aleatoria-com-mais-de-32-caracteres'
export BACKUP_OUTPUT_DIR="$PWD/backup-output"
./scripts/mongodb_backup.sh

export BACKUP_ARCHIVE="$(find backup-output -name '*.archive.gz.gpg' -type f -print -quit)"
export BACKUP_MANIFEST="$(find backup-output -name '*.manifest.json' -type f -print -quit)"
export RESTORE_MONGODB_URI='mongodb://127.0.0.1:27017'
export RESTORE_DATABASE='crelith_restore_test'
export RESTORE_REPORT_PATH="$PWD/backup-output/restore-report.json"
./scripts/mongodb_restore_drill.sh
```

Não copie URIs, senhas, dumps descriptografados ou artefatos para o repositório.
