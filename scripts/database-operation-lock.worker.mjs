import { writeFileSync } from 'node:fs'
import { DatabaseOperationLock } from './database-operation-lock.mjs'
import { prepareMutationJournal } from './database-operation-recovery-journal.mjs'

const [
  rootDir,
  databaseIdentity,
  runtimeId,
  clockOffsetSource = '0',
  action = 'register',
  countSource = '1',
] = process.argv.slice(2)
const clockOffset = Number(clockOffsetSource)
const count = Number(countSource)

try {
  const lock = new DatabaseOperationLock({
    rootDir,
    databaseIdentity,
    runtimeId,
    clock: () => Date.now() + clockOffset,
  })
  if (action === 'register') {
    const lease = lock.registerRuntimeLease()
    process.stdout.write(`${JSON.stringify({ lease, state: lock.readOperationState() })}\n`)
  } else if (action === 'churn') {
    for (let index = 0; index < count; index += 1) {
      const lease = lock.registerRuntimeLease()
      lock.releaseRuntimeLease(lease)
    }
    process.stdout.write(`${JSON.stringify({ state: lock.readOperationState() })}\n`)
  } else if (action.startsWith('intent:')) {
    const targetPhase = action.slice('intent:'.length)
    const lease = lock.registerRuntimeLease()
    let intent = lock.acquireExclusiveIntent('restore', { worker: true })
    if (targetPhase !== 'registered') intent = lock.drainExclusiveIntent(intent)
    lock.releaseRuntimeLease(lease)
    if (['exclusive', 'mutating', 'completed'].includes(targetPhase)) {
      intent = lock.drainExclusiveIntent(intent)
    }
    if (['mutating', 'completed'].includes(targetPhase)) {
      const state = lock.readOperationState()
      const prepared = prepareMutationJournal({
        operationRoot: lock.getPaths().operationRoot,
        stateRevision: state.stateRevision,
        intent,
        writeArtifact({ role, path }) {
          writeFileSync(path, `${role}\0worker-journal`)
          return {
            integrityCheck: 'ok',
            foreignKeyCheck: 'ok',
            schemaContractCheck: 'ok',
            sidecarCheck: 'ok',
          }
        },
      })
      intent = lock.beginExclusiveMutation(intent, prepared.proof)
    }
    if (targetPhase === 'completed') intent = lock.completeExclusiveMutation(intent)
    process.stdout.write(`${JSON.stringify({ intent, state: lock.readOperationState() })}\n`)
  } else {
    throw new Error(`unknown worker action ${action}`)
  }
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
}
