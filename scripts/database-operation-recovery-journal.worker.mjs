import { writeFileSync } from 'node:fs'
import { prepareMutationJournal } from './database-operation-recovery-journal.mjs'

const [operationRoot, stateRevisionSource, intentSource] = process.argv.slice(2)
try {
  const result = prepareMutationJournal({
    operationRoot,
    stateRevision: Number(stateRevisionSource),
    intent: JSON.parse(intentSource),
    writeArtifact({ role, path }) {
      writeFileSync(path, Buffer.from(`worker-${role}\0artifact`, 'utf8'))
      return {
        integrityCheck: 'ok',
        foreignKeyCheck: 'ok',
        schemaContractCheck: 'ok',
        sidecarCheck: 'ok',
      }
    },
  })
  process.stdout.write(`SUCCESS:${result.commitmentSha256}\n`)
} catch (error) {
  process.stdout.write(`ERROR:${error?.code ?? 'UNKNOWN'}\n`)
}
