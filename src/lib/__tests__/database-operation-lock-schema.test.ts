// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

const schema = JSON.parse(
  readFileSync(resolve(process.cwd(), 'schema/database-operation-lock-v1.json'), 'utf8')
) as Record<string, unknown>
const ajv = new Ajv2020({ allErrors: true, discriminator: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)
const validateConcurrencyRule = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'strategy',
    'scope',
    'mutexRecordKind',
    'stateRecordKind',
    'protocolSteps',
    'stateRevision',
    'mutexOwnership',
    'mutations',
  ],
  properties: {
    id: { const: 'registry-mutex-serialized-operation-state-mutation' },
    strategy: { const: 'registry-mutex-serialization' },
    scope: { const: 'databaseIdentity' },
    mutexRecordKind: { const: 'registration_mutex' },
    stateRecordKind: { const: 'operation_state' },
    protocolSteps: {
      type: 'array',
      minItems: 7,
      uniqueItems: true,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['order', 'id', 'requirement'],
        properties: {
          order: { type: 'integer', minimum: 1 },
          id: { type: 'string', minLength: 1 },
          requirement: { type: 'string', minLength: 1 },
        },
      },
    },
    stateRevision: {
      type: 'object',
      additionalProperties: false,
      required: [
        'previousRevisionSource',
        'requiredDelta',
        'nextRevisionExpression',
        'failureRule',
      ],
      properties: {
        previousRevisionSource: { const: 'post-acquisition-reread' },
        requiredDelta: { const: 1 },
        nextRevisionExpression: { const: 'previous.stateRevision + 1' },
        failureRule: { type: 'string', minLength: 1 },
      },
    },
    mutexOwnership: {
      type: 'object',
      additionalProperties: false,
      required: [
        'ownerTokenField',
        'revalidationFields',
        'revalidateImmediatelyBefore',
        'publishGuard',
        'staleRecoveryRule',
      ],
      properties: {
        ownerTokenField: { const: 'mutexId' },
        revalidationFields: {
          type: 'array',
          minItems: 8,
          uniqueItems: true,
          items: { type: 'string', minLength: 1 },
        },
        revalidateImmediatelyBefore: {
          type: 'array',
          minItems: 2,
          uniqueItems: true,
          items: { type: 'string', minLength: 1 },
        },
        publishGuard: { type: 'string', minLength: 1 },
        staleRecoveryRule: { type: 'string', minLength: 1 },
      },
    },
    mutations: {
      type: 'array',
      minItems: 8,
      uniqueItems: true,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'transitionIds', 'serialization', 'stateRevisionDelta'],
        properties: {
          id: { type: 'string', minLength: 1 },
          transitionIds: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string', minLength: 1 },
          },
          serialization: { const: 'registration_mutex' },
          stateRevisionDelta: { const: 1 },
        },
      },
    },
  },
})

type ProtocolTransition = {
  id: string
  operationStateMutation?: boolean
  concurrencyRule?: string
}

type OperationStateConcurrency = {
  id: string
  strategy: string
  protocolSteps: Array<{ order: number; id: string; requirement: string }>
  stateRevision: {
    previousRevisionSource: string
    requiredDelta: number
    nextRevisionExpression: string
    failureRule: string
  }
  mutexOwnership: {
    ownerTokenField: string
    revalidationFields: string[]
    revalidateImmediatelyBefore: string[]
    publishGuard: string
    staleRecoveryRule: string
  }
  mutations: Array<{
    id: string
    transitionIds: string[]
    serialization: string
    stateRevisionDelta: number
  }>
}

const owner = {
  ownerId: 'owner-a',
  runtimeId: 'desktop-runtime-a',
  hostId: 'host-a',
  processId: 1234,
  processStartedAt: '2026-07-14T12:00:00.000Z',
}

function lease(ownerId: string, fencingGeneration: number) {
  return {
    recordKind: 'runtime_lease',
    leaseId: `lease-${ownerId}`,
    owner: {
      ...owner,
      ownerId,
      runtimeId: `runtime-${ownerId}`,
      processId: 1234 + fencingGeneration,
    },
    fencingGeneration,
    acquiredAt: '2026-07-14T12:00:00.000Z',
    heartbeatAt: '2026-07-14T12:00:01.000Z',
    expiresAt: '2026-07-14T12:00:16.000Z',
    ttlMs: 15000,
  }
}

function operationState(overrides: Record<string, unknown> = {}) {
  return {
    protocol: 'shikin.database-operation-lock',
    protocolVersion: 1,
    recordKind: 'operation_state',
    databaseIdentity: 'sha256:empty-fixture-database',
    stateRevision: 4,
    fencingGenerationHighWater: 8,
    leases: [lease('owner-a', 7), lease('owner-b', 8)],
    exclusiveIntent: null,
    updatedBy: owner,
    updatedAt: '2026-07-14T12:00:02.000Z',
    ...overrides,
  }
}

function registrationMutex(mutexId: string, mutexOwner = owner) {
  return {
    protocol: 'shikin.database-operation-lock',
    protocolVersion: 1,
    recordKind: 'registration_mutex',
    databaseIdentity: 'sha256:empty-fixture-database',
    mutexId,
    owner: mutexOwner,
    acquiredAt: '2026-07-14T12:00:00.000Z',
    expiresAt: '2026-07-14T12:00:05.000Z',
    ttlMs: 5000,
  }
}

describe('database operation lock record schema', () => {
  it('validates multiple concurrent runtime leases and the separate registration mutex', () => {
    expect(validate(operationState()), JSON.stringify(validate.errors)).toBe(true)
    expect(validate(registrationMutex('mutex-1')), JSON.stringify(validate.errors)).toBe(true)
  })

  it('allows draining leases after intent publication but requires an empty registry for mutation', () => {
    const drainingIntent = {
      recordKind: 'exclusive_intent',
      operationId: 'restore-1',
      operation: 'restore',
      phase: 'draining',
      owner,
      fencingGeneration: 9,
      createdAt: '2026-07-14T12:00:03.000Z',
      updatedAt: '2026-07-14T12:00:03.000Z',
    }
    expect(
      validate(
        operationState({
          fencingGenerationHighWater: 9,
          exclusiveIntent: drainingIntent,
        })
      ),
      JSON.stringify(validate.errors)
    ).toBe(true)

    expect(
      validate(
        operationState({
          fencingGenerationHighWater: 9,
          exclusiveIntent: { ...drainingIntent, phase: 'mutating' },
        })
      )
    ).toBe(false)
    expect(
      validate(
        operationState({
          fencingGenerationHighWater: 9,
          leases: [],
          exclusiveIntent: { ...drainingIntent, phase: 'mutating' },
        })
      ),
      JSON.stringify(validate.errors)
    ).toBe(true)
  })

  it('rejects arbitrary, legacy-shaped, and under-evidenced records at the root', () => {
    expect(validate({ arbitrary: true })).toBe(false)
    expect(
      validate({
        protocolVersion: 1,
        databaseIdentity: 'db',
        lease: lease('old-owner', 1),
        intent: null,
      })
    ).toBe(false)
    expect(
      validate(
        operationState({
          leases: [
            {
              ...lease('owner-a', 7),
              owner: { ownerId: 'owner-a', runtimeId: 'runtime-a' },
            },
          ],
        })
      )
    ).toBe(false)
    expect(validate({ ...operationState(), unexpected: true })).toBe(false)
  })

  it('declares acquisition through stale-cleanup transitions and replacement invariants', () => {
    const transitions = schema['x-shikin-transitions'] as ProtocolTransition[]
    const invariants = schema['x-shikin-safety-invariants'] as Array<{
      id: string
      rule: string
    }>

    expect(transitions.map(({ id }) => id)).toEqual([
      'acquire-registration-mutex',
      'register-runtime-lease',
      'renew-runtime-lease',
      'acquire-exclusive-intent',
      'drain-runtime-leases',
      'cancel-exclusive-intent',
      'begin-exclusive-mutation',
      'complete-exclusive-mutation',
      'release-record',
      'stale-cleanup',
    ])
    expect(invariants.map(({ id }) => id)).toEqual([
      'unique-runtime-owners',
      'one-exclusive-intent',
      'no-new-leases-while-intent-active',
      'mutex-is-state-coordination-only',
      'serialized-state-mutations',
      'drain-before-mutation',
      'fencing-monotonicity',
      'owner-process-and-generation-match',
      'expired-owner-cannot-mutate',
      'atomic-state-publication',
    ])
    expect(invariants.find(({ id }) => id === 'serialized-state-mutations')?.rule).toContain(
      'cancellation'
    )
    expect(
      invariants.find(({ id }) => id === 'owner-process-and-generation-match')?.rule
    ).toContain('cancellation')
  })

  it('serializes every operation-state mutation behind one revisioned mutex protocol', () => {
    const concurrency = schema['x-shikin-operation-state-concurrency'] as OperationStateConcurrency
    const transitions = schema['x-shikin-transitions'] as ProtocolTransition[]

    expect(
      validateConcurrencyRule(concurrency),
      JSON.stringify(validateConcurrencyRule.errors)
    ).toBe(true)
    expect(concurrency.id).toBe('registry-mutex-serialized-operation-state-mutation')
    expect(concurrency.strategy).toBe('registry-mutex-serialization')
    expect(concurrency.protocolSteps.map(({ order, id }) => [order, id])).toEqual([
      [1, 'acquire-registry-mutex'],
      [2, 'reread-operation-state'],
      [3, 'derive-next-state'],
      [4, 'revalidate-before-publish'],
      [5, 'atomically-publish-state'],
      [6, 'revalidate-before-release'],
      [7, 'release-registry-mutex'],
    ])
    const requirements = new Map(
      concurrency.protocolSteps.map(({ id, requirement }) => [id, requirement])
    )
    expect(requirements.get('acquire-registry-mutex')).toContain('before the authoritative read')
    expect(requirements.get('reread-operation-state')).toContain('MUST reread')
    expect(requirements.get('revalidate-before-publish')).toContain(
      'Immediately before publication'
    )
    expect(requirements.get('atomically-publish-state')).toContain('atomically publish')
    expect(requirements.get('revalidate-before-release')).toContain(
      'Only after successful state publication and immediately before mutex release'
    )
    expect(concurrency.stateRevision).toMatchObject({
      previousRevisionSource: 'post-acquisition-reread',
      requiredDelta: 1,
      nextRevisionExpression: 'previous.stateRevision + 1',
    })
    expect(concurrency.stateRevision.failureRule).toContain('MUST NOT publish')

    const mutationIds = concurrency.mutations.map(({ id }) => id)
    expect(mutationIds).toEqual([
      'lease-registration',
      'lease-renewal',
      'lease-release',
      'stale-cleanup',
      'exclusive-intent-publish',
      'exclusive-intent-phase-change',
      'exclusive-intent-clear',
      'fencing-high-water-advance',
    ])
    for (const mutation of concurrency.mutations) {
      expect(mutation.serialization).toBe('registration_mutex')
      expect(mutation.stateRevisionDelta).toBe(1)
    }

    expect(
      concurrency.mutations.find(({ id }) => id === 'exclusive-intent-clear')?.transitionIds
    ).toEqual(['release-record', 'cancel-exclusive-intent'])
    expect(
      concurrency.mutations.find(({ id }) => id === 'fencing-high-water-advance')?.transitionIds
    ).toEqual([
      'register-runtime-lease',
      'acquire-exclusive-intent',
      'cancel-exclusive-intent',
      'stale-cleanup',
    ])

    const coveredTransitionIds = new Set(
      concurrency.mutations.flatMap(({ transitionIds }) => transitionIds)
    )
    const stateMutationTransitions = transitions.filter(
      ({ operationStateMutation }) => operationStateMutation
    )
    expect(stateMutationTransitions.map(({ id }) => id)).toEqual([
      'register-runtime-lease',
      'renew-runtime-lease',
      'acquire-exclusive-intent',
      'drain-runtime-leases',
      'cancel-exclusive-intent',
      'begin-exclusive-mutation',
      'complete-exclusive-mutation',
      'release-record',
      'stale-cleanup',
    ])
    for (const transition of stateMutationTransitions) {
      expect(transition.concurrencyRule).toBe(concurrency.id)
      expect(coveredTransitionIds).toContain(transition.id)
    }
  })

  it('fences a stale mutex owner before publish and release instead of permitting resurrection', () => {
    const concurrency = schema['x-shikin-operation-state-concurrency'] as OperationStateConcurrency
    const replacementOwner = {
      ...owner,
      ownerId: 'owner-replacement',
      runtimeId: 'runtime-replacement',
      processId: 4321,
    }

    expect(validate(registrationMutex('old-owner-nonce')), JSON.stringify(validate.errors)).toBe(
      true
    )
    expect(
      validate(registrationMutex('replacement-owner-nonce', replacementOwner)),
      JSON.stringify(validate.errors)
    ).toBe(true)
    expect(concurrency.mutexOwnership.ownerTokenField).toBe('mutexId')
    expect(concurrency.mutexOwnership.revalidationFields).toEqual([
      'databaseIdentity',
      'mutexId',
      'owner.ownerId',
      'owner.runtimeId',
      'owner.hostId',
      'owner.processId',
      'owner.processStartedAt',
      'expiresAt',
    ])
    expect(concurrency.mutexOwnership.revalidateImmediatelyBefore).toEqual([
      'operation-state-publish',
      'registry-mutex-release',
    ])
    expect(concurrency.mutexOwnership.publishGuard).toContain('unguarded check-then-write')
    expect(concurrency.mutexOwnership.staleRecoveryRule).toContain('MUST NOT publish')
    expect(concurrency.mutexOwnership.staleRecoveryRule).toContain('successor mutex')
  })
})
