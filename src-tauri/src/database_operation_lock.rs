#![allow(dead_code)] // Checkpoint A compiles/tests this core without runtime wiring.

use std::{
    cell::RefCell,
    collections::HashSet,
    error::Error,
    fmt,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration as StdDuration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use time::{
    format_description::FormatItem, macros::format_description, Duration as TimeDuration,
    OffsetDateTime, PrimitiveDateTime,
};
use uuid::Uuid;

use crate::database_operation_recovery_journal::{
    consume_verified_prepared_mutation_token, release_verified_prepared_mutation_token,
    revalidate_verified_prepared_mutation_token, verify_prepared_mutation_proof,
    JournalError as RecoveryJournalError, JournalIntentBinding, JournalIntentPhase,
    JournalOwnerEvidence, JournalRuntimeId, PreparedCommitment, PreparedMutationProof,
    RecoveryOperation as JournalRecoveryOperation,
};

#[cfg(test)]
use std::sync::{Arc, Barrier};

const PROTOCOL: &str = "shikin.database-operation-lock";
const RECOVERY_JOURNAL_PROTOCOL: &str = "shikin.database-operation-recovery-journal";
const PROTOCOL_VERSION: u8 = 1;
pub(crate) const SHIKIN_DATABASE_IDENTITY: &str = "com.asf.shikin:shikin.db";
const PRIVATE_DIR_MODE: u32 = 0o700;
const PRIVATE_FILE_MODE: u32 = 0o600;
const DEFAULT_MUTEX_TTL_MS: u64 = 5_000;
const DEFAULT_LEASE_TTL_MS: u64 = 30_000;
const DEFAULT_HEARTBEAT_MS: u64 = 5_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_MAX_STATE_RECORDS: usize = 8;
const MUTEX_MIN_TTL_MS: u64 = 1_000;
const MUTEX_MAX_TTL_MS: u64 = 15_000;
const LEASE_MIN_TTL_MS: u64 = 5_000;
const LEASE_MAX_TTL_MS: u64 = 300_000;
const HEARTBEAT_MIN_MS: u64 = 1_000;
const READ_RETRY_LIMIT: usize = 16;
const MAX_JSON_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const TIMESTAMP_FORMAT: &[FormatItem<'static>] =
    format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");

#[derive(Debug)]
struct LockError {
    code: &'static str,
    message: String,
    source: Option<Box<dyn Error + Send + Sync>>,
}

impl LockError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    fn with_source(
        code: &'static str,
        message: impl Into<String>,
        source: impl Error + Send + Sync + 'static,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }

    fn io(context: &str, error: io::Error) -> Self {
        let code = if error.kind() == io::ErrorKind::NotFound {
            "NOT_FOUND"
        } else {
            "FILESYSTEM_FAILURE"
        };
        Self::with_source(code, format!("{context}: {error}"), error)
    }

    fn from_recovery_journal(error: RecoveryJournalError) -> Self {
        Self::with_source(error.code(), error.to_string(), error)
    }
}

impl fmt::Display for LockError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl Error for LockError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.source
            .as_deref()
            .map(|source| source as &(dyn Error + 'static))
    }
}

type LockResult<T> = Result<T, LockError>;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum RuntimeId {
    Cli,
    Mcp,
    BrowserDataServer,
    Tauri,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnerEvidence {
    owner_id: String,
    runtime_id: RuntimeId,
    host_id: String,
    process_id: u32,
    process_started_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeLease {
    record_kind: RuntimeLeaseKind,
    lease_id: String,
    owner: OwnerEvidence,
    fencing_generation: u64,
    acquired_at: String,
    heartbeat_at: String,
    expires_at: String,
    ttl_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeLeaseKind {
    RuntimeLease,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum DatabaseOperation {
    Restore,
    Import,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ExclusivePhase {
    Registered,
    Draining,
    Exclusive,
    Mutating,
    Completed,
    Abandoned,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExclusiveIntent {
    record_kind: ExclusiveIntentKind,
    operation_id: String,
    operation: DatabaseOperation,
    phase: ExclusivePhase,
    owner: OwnerEvidence,
    fencing_generation: u64,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<JsonMap<String, JsonValue>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ExclusiveIntentKind {
    ExclusiveIntent,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationState {
    protocol: String,
    protocol_version: u8,
    record_kind: OperationStateKind,
    database_identity: String,
    state_revision: u64,
    fencing_generation_high_water: u64,
    leases: Vec<RuntimeLease>,
    exclusive_intent: Option<ExclusiveIntent>,
    updated_by: OwnerEvidence,
    updated_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum OperationStateKind {
    OperationState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistrationMutex {
    protocol: String,
    protocol_version: u8,
    record_kind: RegistrationMutexKind,
    database_identity: String,
    mutex_id: String,
    owner: OwnerEvidence,
    acquired_at: String,
    expires_at: String,
    ttl_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RegistrationMutexKind {
    RegistrationMutex,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostIdentity {
    host_id: String,
}

#[derive(Clone, Debug)]
struct LockPaths {
    root: PathBuf,
    host_identity: PathBuf,
    protocol_root: PathBuf,
    operation_root: PathBuf,
    state_records: PathBuf,
    registration_mutex: PathBuf,
}

#[derive(Clone, Copy, Debug)]
struct Timing {
    mutex_ttl_ms: u64,
    lease_ttl_ms: u64,
    heartbeat_interval_ms: u64,
    acquire_timeout_ms: u64,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            mutex_ttl_ms: DEFAULT_MUTEX_TTL_MS,
            lease_ttl_ms: DEFAULT_LEASE_TTL_MS,
            heartbeat_interval_ms: DEFAULT_HEARTBEAT_MS,
            acquire_timeout_ms: DEFAULT_ACQUIRE_TIMEOUT_MS,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StaleCleanupResult {
    removed_lease_ids: Vec<String>,
    abandoned_intent: bool,
    state_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct LifecycleHealth {
    healthy: bool,
    fenced: bool,
    registered: bool,
    should_drain: bool,
    reason: Option<String>,
    state_revision: Option<u64>,
    fencing_generation: Option<u64>,
    maintenance_degraded: bool,
    durability_uncertain: bool,
    last_committed_state_revision: Option<u64>,
}

#[derive(Debug)]
struct MutexGuard {
    record: RegistrationMutex,
    token_path: PathBuf,
}

#[derive(Debug)]
enum Mutation<T> {
    Change(Box<OperationState>, T),
    NoChange(T),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DirectorySync {
    Synced,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DurabilityPolicy {
    ExistingBestEffort,
    RequiredForMutationAuthority,
}

struct StatePublicationOptions<B, O> {
    before_final_fence: B,
    on_committed: O,
    durability_policy: DurabilityPolicy,
}

#[derive(Clone, Debug)]
struct StatePublicationContext {
    stage_path: PathBuf,
    state_path: Option<PathBuf>,
    next_state: OperationState,
}

#[derive(Debug)]
enum MutexInspection {
    Absent,
    Retry,
    Incomplete {
        metadata: fs::Metadata,
        stale_at_ms: i128,
    },
    Complete {
        metadata: fs::Metadata,
        record: Box<RegistrationMutex>,
        token_path: PathBuf,
    },
}

#[derive(Debug)]
struct DatabaseOperationLock {
    database_identity: String,
    runtime_id: RuntimeId,
    owner_id: String,
    paths: LockPaths,
    timing: Timing,
    max_state_records: usize,
    clock_offset_ms: i64,
    owner: Option<OwnerEvidence>,
    current_lease: Option<RuntimeLease>,
    fenced: bool,
    last_failure: Option<String>,
    maintenance_failures: Vec<String>,
    durability_uncertain: bool,
    last_committed_state_revision: Option<u64>,
    #[cfg(test)]
    fault_point: Option<&'static str>,
    #[cfg(test)]
    read_turnover_once: bool,
    #[cfg(test)]
    after_release_barrier: Option<Arc<Barrier>>,
    #[cfg(test)]
    release_quarantine_barrier: Option<Arc<Barrier>>,
}

impl DatabaseOperationLock {
    fn new(
        root_dir: PathBuf,
        database_identity: String,
        runtime_id: RuntimeId,
    ) -> LockResult<Self> {
        if database_identity != SHIKIN_DATABASE_IDENTITY {
            return Err(LockError::new(
                "INVALID_DATABASE_IDENTITY",
                format!("databaseIdentity must be {SHIKIN_DATABASE_IDENTITY}"),
            ));
        }
        if root_dir.as_os_str().is_empty() {
            return Err(LockError::new("INVALID_OPTIONS", "root path is empty"));
        }
        let root_dir = absolute_lexical_path(root_dir)?;
        let identity_hash = sha256_hex(SHIKIN_DATABASE_IDENTITY.as_bytes());
        let protocol_root = root_dir.join("database-operation-lock-v1");
        let operation_root = protocol_root.join(identity_hash);
        let timing = Timing::default();
        validate_timing(timing)?;
        Ok(Self {
            database_identity,
            runtime_id,
            owner_id: Uuid::new_v4().to_string(),
            paths: LockPaths {
                host_identity: root_dir.join("machine-host-identity.json"),
                state_records: operation_root.join("state-records"),
                registration_mutex: operation_root.join("registration-mutex"),
                root: root_dir,
                protocol_root,
                operation_root,
            },
            timing,
            max_state_records: DEFAULT_MAX_STATE_RECORDS,
            clock_offset_ms: 0,
            owner: None,
            current_lease: None,
            fenced: false,
            last_failure: None,
            maintenance_failures: Vec::new(),
            durability_uncertain: false,
            last_committed_state_revision: None,
            #[cfg(test)]
            fault_point: None,
            #[cfg(test)]
            read_turnover_once: false,
            #[cfg(test)]
            after_release_barrier: None,
            #[cfg(test)]
            release_quarantine_barrier: None,
        })
    }

    fn with_timing(mut self, timing: Timing) -> LockResult<Self> {
        validate_timing(timing)?;
        self.timing = timing;
        Ok(self)
    }

    fn with_clock_offset(mut self, offset_ms: i64) -> Self {
        self.clock_offset_ms = offset_ms;
        self
    }

    fn paths(&self) -> &LockPaths {
        &self.paths
    }

    fn owner_evidence(&mut self) -> LockResult<OwnerEvidence> {
        self.ensure_owner()
    }

    fn read_operation_state(&mut self) -> LockResult<OperationState> {
        self.ensure_owner()?;
        self.read_authoritative_state()
    }

    fn register_runtime_lease(&mut self) -> LockResult<RuntimeLease> {
        let lease_ttl_ms = self.timing.lease_ttl_ms;
        let owner = self.ensure_owner()?;
        let lease_id = Uuid::new_v4().to_string();
        let lease = self.mutate_state(move |previous, now| {
            if previous.exclusive_intent.is_some() {
                return Err(LockError::new(
                    "EXCLUSIVE_INTENT_ACTIVE",
                    "exclusive intent blocks lease registration",
                ));
            }
            if previous
                .leases
                .iter()
                .any(|lease| lease.owner.owner_id == owner.owner_id)
            {
                return Err(LockError::new(
                    "OWNER_ALREADY_REGISTERED",
                    "owner already has a lease",
                ));
            }
            let generation = increment_authority(
                previous.fencing_generation_high_water,
                "fencing generation high-water",
            )?;
            let timestamp = format_timestamp(now)?;
            let lease = RuntimeLease {
                record_kind: RuntimeLeaseKind::RuntimeLease,
                lease_id,
                owner,
                fencing_generation: generation,
                acquired_at: timestamp.clone(),
                heartbeat_at: timestamp,
                expires_at: format_timestamp(now + i128::from(lease_ttl_ms))?,
                ttl_ms: lease_ttl_ms,
            };
            let mut next = previous;
            next.fencing_generation_high_water = generation;
            next.leases.push(lease.clone());
            Ok(Mutation::Change(Box::new(next), lease))
        })?;
        self.current_lease = Some(lease.clone());
        Ok(lease)
    }

    fn renew_runtime_lease(&mut self, evidence: &RuntimeLease) -> LockResult<RuntimeLease> {
        validate_lease(evidence)?;
        self.require_owner(&evidence.owner, "LEASE_FENCED")?;
        let evidence = evidence.clone();
        let update_current = self
            .current_lease
            .as_ref()
            .is_some_and(|lease| same_lease_authority(lease, &evidence));
        let renewed = self.mutate_state(move |mut previous, now| {
            let current = previous
                .leases
                .iter_mut()
                .find(|lease| lease.lease_id == evidence.lease_id)
                .ok_or_else(|| LockError::new("LEASE_FENCED", "lease is absent"))?;
            if !same_lease_authority(current, &evidence) {
                return Err(LockError::new("LEASE_FENCED", "lease evidence changed"));
            }
            if expired(&current.expires_at, now)? {
                return Err(LockError::new(
                    "LEASE_EXPIRED",
                    "expired lease cannot renew",
                ));
            }
            current.heartbeat_at = format_timestamp(now)?;
            current.expires_at = format_timestamp(now + i128::from(current.ttl_ms))?;
            let value = current.clone();
            Ok(Mutation::Change(Box::new(previous), value))
        })?;
        if update_current {
            self.current_lease = Some(renewed.clone());
        }
        Ok(renewed)
    }

    fn release_runtime_lease(&mut self, evidence: &RuntimeLease) -> LockResult<bool> {
        validate_lease(evidence)?;
        self.require_owner(&evidence.owner, "LEASE_FENCED")?;
        let evidence = evidence.clone();
        let clear_current = self
            .current_lease
            .as_ref()
            .is_some_and(|lease| same_lease_authority(lease, &evidence));
        let released = self.mutate_state(move |mut previous, _| {
            let index = previous
                .leases
                .iter()
                .position(|lease| lease.lease_id == evidence.lease_id)
                .ok_or_else(|| LockError::new("LEASE_FENCED", "lease is absent"))?;
            if !same_lease_authority(&previous.leases[index], &evidence) {
                return Err(LockError::new("LEASE_FENCED", "lease evidence changed"));
            }
            previous.leases.remove(index);
            Ok(Mutation::Change(Box::new(previous), true))
        })?;
        if clear_current {
            self.current_lease = None;
        }
        Ok(released)
    }

    fn cleanup_stale_records(&mut self) -> LockResult<StaleCleanupResult> {
        self.require_operational_owner()?;
        let host_id = self.ensure_owner()?.host_id;
        let paths = self.paths.clone();
        self.mutate_state(move |mut previous, now| {
            let mut removed = Vec::new();
            let mut retained = Vec::new();
            for lease in previous.leases {
                if expired(&lease.expires_at, now)?
                    && owner_demonstrably_dead(&paths, &host_id, &lease.owner)?
                {
                    removed.push(lease.lease_id);
                } else {
                    retained.push(lease);
                }
            }
            previous.leases = retained;
            let should_remove_intent = previous.exclusive_intent.as_ref().is_some_and(|intent| {
                intent.phase != ExclusivePhase::Mutating && previous.leases.is_empty()
            });
            let mut abandoned = false;
            if should_remove_intent {
                let intent = previous.exclusive_intent.as_ref().expect("intent checked");
                if owner_demonstrably_dead(&paths, &host_id, &intent.owner)? {
                    previous.fencing_generation_high_water = increment_authority(
                        previous.fencing_generation_high_water,
                        "fencing generation high-water",
                    )?;
                    previous.exclusive_intent = None;
                    abandoned = true;
                }
            }
            if removed.is_empty() && !abandoned {
                let revision = previous.state_revision;
                return Ok(Mutation::NoChange(StaleCleanupResult {
                    removed_lease_ids: removed,
                    abandoned_intent: false,
                    state_revision: revision,
                }));
            }
            let revision = increment_authority(previous.state_revision, "state revision")?;
            Ok(Mutation::Change(
                Box::new(previous),
                StaleCleanupResult {
                    removed_lease_ids: removed,
                    abandoned_intent: abandoned,
                    state_revision: revision,
                },
            ))
        })
    }

    fn acquire_exclusive_intent(
        &mut self,
        operation: DatabaseOperation,
        metadata: Option<JsonMap<String, JsonValue>>,
    ) -> LockResult<ExclusiveIntent> {
        validate_caller_intent_metadata(metadata.as_ref())?;
        self.require_operational_owner()?;
        let owner = self.ensure_owner()?;
        let current_lease = self.current_lease.clone();
        let operation_id = Uuid::new_v4().to_string();
        self.mutate_state(move |mut previous, now| {
            if previous.exclusive_intent.is_some() {
                return Err(LockError::new(
                    "EXCLUSIVE_INTENT_ACTIVE",
                    "exclusive intent already exists",
                ));
            }
            let current_lease = current_lease.as_ref().ok_or_else(|| {
                LockError::new(
                    "LEASE_REQUIRED",
                    "exclusive intent requires one active owner lease",
                )
            })?;
            let persisted_by_owner_id: Vec<&RuntimeLease> = previous
                .leases
                .iter()
                .filter(|lease| lease.owner.owner_id == owner.owner_id)
                .collect();
            let own_leases: Vec<&RuntimeLease> = previous
                .leases
                .iter()
                .filter(|lease| same_owner(&lease.owner, &owner))
                .collect();
            if persisted_by_owner_id.len() != 1 || own_leases.len() != 1 {
                return Err(LockError::new(
                    "LEASE_FENCED",
                    "exclusive intent requires exactly one complete owner lease",
                ));
            }
            let own_lease = own_leases[0];
            if !same_lease_authority(own_lease, current_lease) {
                return Err(LockError::new(
                    "LEASE_FENCED",
                    "current lease does not match persisted authority",
                ));
            }
            if expired(&own_lease.expires_at, now)? {
                return Err(LockError::new(
                    "LEASE_EXPIRED",
                    "expired owner cannot publish an intent",
                ));
            }
            let generation = increment_authority(
                previous.fencing_generation_high_water,
                "fencing generation high-water",
            )?;
            let timestamp = format_timestamp(now)?;
            let intent = ExclusiveIntent {
                record_kind: ExclusiveIntentKind::ExclusiveIntent,
                operation_id,
                operation,
                phase: ExclusivePhase::Registered,
                owner,
                fencing_generation: generation,
                created_at: timestamp.clone(),
                updated_at: timestamp,
                completed_at: None,
                metadata,
            };
            previous.fencing_generation_high_water = generation;
            previous.exclusive_intent = Some(intent.clone());
            Ok(Mutation::Change(Box::new(previous), intent))
        })
    }

    fn drain_exclusive_intent(
        &mut self,
        evidence: &ExclusiveIntent,
    ) -> LockResult<ExclusiveIntent> {
        validate_intent(evidence)?;
        self.require_owner(&evidence.owner, "INTENT_FENCED")?;
        let evidence = evidence.clone();
        self.mutate_state(move |mut previous, now| {
            let high_water_phase = previous
                .exclusive_intent
                .as_ref()
                .map(|intent| intent.phase);
            let next_phase = if high_water_phase == Some(ExclusivePhase::Registered) {
                ExclusivePhase::Draining
            } else if previous.leases.is_empty() {
                ExclusivePhase::Exclusive
            } else {
                ExclusivePhase::Draining
            };
            let current = require_intent(
                &mut previous,
                &evidence,
                &[ExclusivePhase::Registered, ExclusivePhase::Draining],
            )?;
            if current.phase == next_phase {
                return Ok(Mutation::NoChange(current.clone()));
            }
            current.phase = next_phase;
            current.updated_at = format_timestamp(now)?;
            let value = current.clone();
            Ok(Mutation::Change(Box::new(previous), value))
        })
    }

    fn begin_exclusive_mutation(
        &mut self,
        evidence: &ExclusiveIntent,
        proof: &PreparedMutationProof,
    ) -> LockResult<ExclusiveIntent> {
        validate_intent(evidence)?;
        self.require_owner(&evidence.owner, "INTENT_FENCED")?;
        self.require_operational_owner()?;
        let advisory = self.read_authoritative_state()?;
        let advisory_binding =
            mutation_entry_binding(&advisory, evidence, &self.paths.operation_root)?;
        let token =
            verify_prepared_mutation_proof(proof, &self.paths.operation_root, &advisory_binding)
                .map_err(LockError::from_recovery_journal)?;
        let token = RefCell::new(token);
        let prepared_commitment =
            revalidate_verified_prepared_mutation_token(&token.borrow(), &advisory_binding)
                .map_err(LockError::from_recovery_journal)?;
        let authoritative_binding = RefCell::new(None::<JournalIntentBinding>);
        let evidence = evidence.clone();
        let operation_root = self.paths.operation_root.clone();
        let result = self.mutate_state_with_options(
            |mut previous, now| {
                let binding = mutation_entry_binding(&previous, &evidence, &operation_root)?;
                authoritative_binding.replace(Some(binding.clone()));
                let current = previous
                    .exclusive_intent
                    .as_mut()
                    .expect("mutation binding requires an intent");
                current.phase = ExclusivePhase::Mutating;
                current.updated_at = format_timestamp(now)?;
                current.metadata = Some(metadata_with_recovery_commitment(
                    current.metadata.take(),
                    &binding,
                    &prepared_commitment,
                ));
                let value = current.clone();
                Ok(Mutation::Change(Box::new(previous), value))
            },
            StatePublicationOptions {
                before_final_fence: |_| {
                    let binding = authoritative_binding.borrow();
                    let commitment = revalidate_verified_prepared_mutation_token(
                        &token.borrow(),
                        binding.as_ref().ok_or_else(|| {
                            LockError::new(
                                "PREPARED_PROOF_INVALID",
                                "authoritative mutation binding is unavailable",
                            )
                        })?,
                    )
                    .map_err(LockError::from_recovery_journal)?;
                    if commitment != prepared_commitment {
                        return Err(LockError::new(
                            "PREPARED_PROOF_INVALID",
                            "prepared commitment changed during mutex revalidation",
                        ));
                    }
                    Ok(())
                },
                on_committed: |_| {
                    consume_verified_prepared_mutation_token(&mut token.borrow_mut());
                },
                durability_policy: DurabilityPolicy::RequiredForMutationAuthority,
            },
        );
        release_verified_prepared_mutation_token(&mut token.borrow_mut());
        result
    }

    fn complete_exclusive_mutation(
        &mut self,
        evidence: &ExclusiveIntent,
    ) -> LockResult<ExclusiveIntent> {
        validate_intent(evidence)?;
        self.require_owner(&evidence.owner, "INTENT_FENCED")?;
        let evidence = evidence.clone();
        self.mutate_state(move |mut previous, now| {
            let high_water = previous.fencing_generation_high_water;
            let current = require_intent(&mut previous, &evidence, &[ExclusivePhase::Mutating])?;
            if current.fencing_generation != high_water {
                return Err(LockError::new(
                    "INTENT_FENCED",
                    "intent is not high-water owner",
                ));
            }
            let timestamp = format_timestamp(now)?;
            current.phase = ExclusivePhase::Completed;
            current.updated_at = timestamp.clone();
            current.completed_at = Some(timestamp);
            let value = current.clone();
            Ok(Mutation::Change(Box::new(previous), value))
        })
    }

    fn clear_exclusive_intent(&mut self, evidence: &ExclusiveIntent) -> LockResult<bool> {
        validate_intent(evidence)?;
        self.require_owner(&evidence.owner, "INTENT_FENCED")?;
        let evidence = evidence.clone();
        self.mutate_state(move |mut previous, _| {
            require_intent(&mut previous, &evidence, &[ExclusivePhase::Completed])?;
            previous.exclusive_intent = None;
            Ok(Mutation::Change(Box::new(previous), true))
        })
    }

    fn cancel_exclusive_intent(&mut self, evidence: &ExclusiveIntent) -> LockResult<bool> {
        validate_intent(evidence)?;
        self.require_owner(&evidence.owner, "INTENT_FENCED")?;
        let evidence = evidence.clone();
        self.mutate_state(move |mut previous, _| {
            let current = previous
                .exclusive_intent
                .as_ref()
                .ok_or_else(|| LockError::new("INTENT_FENCED", "intent is absent"))?;
            if !same_intent_authority(current, &evidence) {
                return Err(LockError::new(
                    "INTENT_FENCED",
                    "intent authority no longer matches",
                ));
            }
            if !matches!(
                current.phase,
                ExclusivePhase::Registered | ExclusivePhase::Draining | ExclusivePhase::Exclusive
            ) {
                return Err(LockError::new(
                    "INTENT_PHASE_INVALID",
                    "persisted intent phase cannot be cancelled",
                ));
            }
            increment_cancellation_counter(previous.state_revision, "stateRevision")?;
            previous.fencing_generation_high_water = increment_cancellation_counter(
                previous.fencing_generation_high_water,
                "fencingGenerationHighWater",
            )?;
            previous.exclusive_intent = None;
            Ok(Mutation::Change(Box::new(previous), true))
        })
    }

    fn assert_runtime_authority(&mut self, evidence: &RuntimeLease) -> LockResult<RuntimeLease> {
        self.require_operational_owner()?;
        validate_lease(evidence)?;
        self.require_owner(&evidence.owner, "LEASE_FENCED")?;
        let now = self.now_ms()?;
        let state = self.read_authoritative_state()?;
        let current = state
            .leases
            .iter()
            .find(|lease| lease.lease_id == evidence.lease_id)
            .filter(|lease| same_lease_authority(lease, evidence));
        if let Some(current) = current {
            if !expired(&current.expires_at, now)? {
                return Ok(current.clone());
            }
        }
        self.fenced = true;
        self.last_failure = Some("runtime lease is absent, expired, or superseded".into());
        Err(LockError::new(
            "LEASE_FENCED",
            "runtime lease is absent, expired, or superseded",
        ))
    }

    fn assert_exclusive_authority(
        &mut self,
        evidence: &ExclusiveIntent,
        phase: ExclusivePhase,
    ) -> LockResult<ExclusiveIntent> {
        self.require_operational_owner()?;
        validate_intent(evidence)?;
        self.require_owner(&evidence.owner, "INTENT_FENCED")?;
        let state = self.read_authoritative_state()?;
        let current = state
            .exclusive_intent
            .ok_or_else(|| LockError::new("INTENT_FENCED", "intent is absent"))?;
        if !same_intent_authority(&current, evidence)
            || current.phase != phase
            || current.fencing_generation != state.fencing_generation_high_water
        {
            return Err(LockError::new(
                "INTENT_FENCED",
                "intent authority, phase, or high-water evidence changed",
            ));
        }
        Ok(current)
    }

    fn lifecycle_health(&mut self) -> LifecycleHealth {
        let maintenance_degraded = !self.maintenance_failures.is_empty();
        if self.fenced {
            return LifecycleHealth {
                healthy: false,
                fenced: true,
                registered: false,
                should_drain: false,
                reason: self.last_failure.clone(),
                state_revision: self.last_committed_state_revision,
                fencing_generation: self
                    .current_lease
                    .as_ref()
                    .map(|lease| lease.fencing_generation),
                maintenance_degraded,
                durability_uncertain: self.durability_uncertain,
                last_committed_state_revision: self.last_committed_state_revision,
            };
        }
        let Some(lease) = self.current_lease.clone() else {
            let state_revision = self
                .read_operation_state()
                .ok()
                .map(|state| state.state_revision);
            return LifecycleHealth {
                healthy: false,
                fenced: false,
                registered: false,
                should_drain: false,
                reason: self
                    .maintenance_failures
                    .last()
                    .cloned()
                    .or_else(|| Some("no runtime lease is registered".into())),
                state_revision,
                fencing_generation: None,
                maintenance_degraded,
                durability_uncertain: false,
                last_committed_state_revision: self.last_committed_state_revision,
            };
        };
        match self.assert_runtime_authority(&lease) {
            Ok(current) => match self.read_authoritative_state() {
                Ok(state) => LifecycleHealth {
                    healthy: !maintenance_degraded,
                    fenced: false,
                    registered: true,
                    should_drain: state.exclusive_intent.is_some(),
                    reason: self.maintenance_failures.last().cloned().or_else(|| {
                        state
                            .exclusive_intent
                            .as_ref()
                            .map(|_| "exclusive database intent is active".into())
                    }),
                    state_revision: Some(state.state_revision),
                    fencing_generation: Some(current.fencing_generation),
                    maintenance_degraded,
                    durability_uncertain: false,
                    last_committed_state_revision: self.last_committed_state_revision,
                },
                Err(error) => self.failed_health(error),
            },
            Err(error) => self.failed_health(error),
        }
    }

    fn failed_health(&mut self, error: LockError) -> LifecycleHealth {
        self.fenced = true;
        self.last_failure = Some(error.to_string());
        LifecycleHealth {
            healthy: false,
            fenced: true,
            registered: false,
            should_drain: false,
            reason: self.last_failure.clone(),
            state_revision: self.last_committed_state_revision,
            fencing_generation: self
                .current_lease
                .as_ref()
                .map(|lease| lease.fencing_generation),
            maintenance_degraded: !self.maintenance_failures.is_empty(),
            durability_uncertain: self.durability_uncertain,
            last_committed_state_revision: self.last_committed_state_revision,
        }
    }

    fn ensure_owner(&mut self) -> LockResult<OwnerEvidence> {
        if let Some(owner) = &self.owner {
            return Ok(owner.clone());
        }
        self.ensure_paths()?;
        let owner = OwnerEvidence {
            owner_id: self.owner_id.clone(),
            runtime_id: self.runtime_id,
            host_id: read_or_create_host_identity(&self.paths.host_identity)?,
            process_id: std::process::id(),
            process_started_at: current_process_started_at()?,
        };
        validate_owner(&owner)?;
        self.owner = Some(owner.clone());
        Ok(owner)
    }

    fn require_operational_owner(&self) -> LockResult<()> {
        if self.fenced {
            Err(LockError::new(
                "OWNER_SELF_FENCED",
                self.last_failure
                    .as_deref()
                    .unwrap_or("owner is self-fenced"),
            ))
        } else {
            Ok(())
        }
    }

    fn record_maintenance_failure(&mut self, error: &LockError, uncertain: bool) {
        self.maintenance_failures.push(error.to_string());
        if uncertain {
            self.durability_uncertain = true;
            self.fenced = true;
            self.last_failure = Some(format!(
                "PUBLICATION_DURABILITY_UNCERTAIN: committed publication durability is uncertain: {error}"
            ));
        }
    }

    #[cfg(test)]
    fn with_fault(mut self, point: &'static str) -> Self {
        self.fault_point = Some(point);
        self
    }

    #[cfg(test)]
    fn with_read_turnover(mut self) -> Self {
        self.read_turnover_once = true;
        self
    }

    #[cfg(test)]
    fn with_after_release_barrier(mut self, barrier: Arc<Barrier>) -> Self {
        self.after_release_barrier = Some(barrier);
        self
    }

    #[cfg(test)]
    fn with_release_quarantine_barrier(mut self, barrier: Arc<Barrier>) -> Self {
        self.release_quarantine_barrier = Some(barrier);
        self
    }

    fn inject_fault(&self, _point: &'static str) -> LockResult<()> {
        #[cfg(test)]
        if self.fault_point == Some(_point) {
            return Err(LockError::new("INJECTED_FAILURE", _point));
        }
        Ok(())
    }

    fn sync_state_records_directory(&self) -> LockResult<DirectorySync> {
        #[cfg(test)]
        if self.fault_point == Some("directory_sync_unsupported") {
            return Ok(DirectorySync::Unsupported);
        }
        #[cfg(test)]
        if self.fault_point == Some("directory_sync_failure") {
            return Err(LockError::new(
                "FILESYSTEM_FAILURE",
                "injected state-directory sync failure",
            ));
        }
        sync_directory(&self.paths.state_records)
    }

    fn require_owner(&mut self, owner: &OwnerEvidence, code: &'static str) -> LockResult<()> {
        if same_owner(owner, &self.ensure_owner()?) {
            Ok(())
        } else {
            Err(LockError::new(
                code,
                "owner evidence belongs to another instance",
            ))
        }
    }

    fn ensure_paths(&self) -> LockResult<()> {
        ensure_canonical_private_root(&self.paths.root)?;
        ensure_private_directory(&self.paths.protocol_root, &self.paths.root)?;
        ensure_private_directory(&self.paths.operation_root, &self.paths.root)?;
        ensure_private_directory(&self.paths.state_records, &self.paths.root)
    }

    fn now_ms(&self) -> LockResult<i128> {
        let base = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| LockError::new("CLOCK_FAILURE", error.to_string()))?
            .as_millis() as i128;
        Ok(base + i128::from(self.clock_offset_ms))
    }

    fn mutate_state<T, F>(&mut self, mutator: F) -> LockResult<T>
    where
        F: FnOnce(OperationState, i128) -> LockResult<Mutation<T>>,
    {
        self.mutate_state_with_options(
            mutator,
            StatePublicationOptions {
                before_final_fence: |_| Ok(()),
                on_committed: |_| {},
                durability_policy: DurabilityPolicy::ExistingBestEffort,
            },
        )
    }

    fn mutate_state_with_options<T, F, B, O>(
        &mut self,
        mutator: F,
        options: StatePublicationOptions<B, O>,
    ) -> LockResult<T>
    where
        F: FnOnce(OperationState, i128) -> LockResult<Mutation<T>>,
        B: FnOnce(StatePublicationContext) -> LockResult<()>,
        O: FnOnce(StatePublicationContext),
    {
        self.require_operational_owner()?;
        let owner = self.ensure_owner()?;
        let guard = self.acquire_mutex()?;
        let StatePublicationOptions {
            before_final_fence,
            on_committed,
            durability_policy,
        } = options;
        let prepared = (|| {
            let previous = self.read_authoritative_state()?;
            let now = self.now_ms()?;
            match mutator(previous.clone(), now)? {
                Mutation::NoChange(value) => Ok((None, value)),
                Mutation::Change(mut next, value) => {
                    if next.fencing_generation_high_water < previous.fencing_generation_high_water {
                        return Err(LockError::new(
                            "INVALID_MUTATION",
                            "fencing high-water decreased",
                        ));
                    }
                    next.protocol = PROTOCOL.into();
                    next.protocol_version = PROTOCOL_VERSION;
                    next.record_kind = OperationStateKind::OperationState;
                    next.database_identity = self.database_identity.clone();
                    next.state_revision =
                        increment_authority(previous.state_revision, "state revision")?;
                    next.updated_by = owner;
                    next.updated_at = format_timestamp(now)?;
                    validate_state(&next, &self.database_identity)?;
                    let stage = self.stage_state(&guard, &next)?;
                    self.prune_for_publication()?;
                    self.inject_fault("after_prune")?;
                    let context = StatePublicationContext {
                        stage_path: stage.clone(),
                        state_path: None,
                        next_state: (*next).clone(),
                    };
                    before_final_fence(context.clone())?;
                    self.revalidate_mutex(&guard)?;
                    Ok((Some((next, stage, context)), value))
                }
            }
        })();

        let (publication, value) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                if let Err(release_error) = self.release_mutex(&guard) {
                    self.record_maintenance_failure(&release_error, false);
                }
                return Err(error);
            }
        };
        let Some((next, stage, mut context)) = publication else {
            if let Err(error) = self.release_mutex(&guard) {
                self.record_maintenance_failure(&error, false);
            }
            return Ok(value);
        };

        let destination = match self.rename_staged_state(&guard, &stage, next.state_revision) {
            Ok(destination) => destination,
            Err(error) => {
                if let Err(release_error) = self.release_mutex(&guard) {
                    self.record_maintenance_failure(&release_error, false);
                }
                return Err(error);
            }
        };
        self.last_committed_state_revision = Some(next.state_revision);
        context.state_path = Some(destination);

        let mut strict_failure = None;
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            on_committed(context.clone());
        }))
        .is_err()
        {
            let failure = LockError::new(
                "INTERNAL_FAILURE",
                "committed state callback violated its infallible contract",
            );
            self.record_maintenance_failure(&failure, true);
            strict_failure = Some(LockError::with_source(
                "MUTATION_COMMIT_DURABILITY_UNCERTAIN",
                "committed mutation-entry publication failed in its infallible commit callback",
                failure,
            ));
        }

        if strict_failure.is_none() {
            match self
                .inject_fault("after_rename")
                .and_then(|()| self.sync_state_records_directory())
            {
                Ok(DirectorySync::Synced) => {
                    if let Err(error) = self.inject_fault("after_fsync") {
                        self.record_maintenance_failure(&error, false);
                    }
                }
                Ok(DirectorySync::Unsupported)
                    if durability_policy == DurabilityPolicy::RequiredForMutationAuthority =>
                {
                    let failure = LockError::new(
                        "DIRECTORY_SYNC_UNSUPPORTED",
                        "state record is committed but directory fsync is unsupported",
                    );
                    self.record_maintenance_failure(&failure, true);
                    strict_failure = Some(LockError::with_source(
                        "MUTATION_COMMIT_DURABILITY_UNCERTAIN",
                        "committed mutation-entry publication directory durability is unsupported",
                        failure,
                    ));
                }
                Ok(DirectorySync::Unsupported) => {
                    let failure = LockError::new(
                        "DIRECTORY_SYNC_UNSUPPORTED",
                        "State record is published but directory fsync is unsupported",
                    );
                    self.record_maintenance_failure(&failure, false);
                }
                Err(error) => {
                    self.record_maintenance_failure(&error, true);
                    if durability_policy == DurabilityPolicy::RequiredForMutationAuthority {
                        strict_failure = Some(LockError::with_source(
                            "MUTATION_COMMIT_DURABILITY_UNCERTAIN",
                            "committed mutation-entry publication directory durability is uncertain",
                            error,
                        ));
                    }
                }
            }
        }

        match self.release_mutex(&guard) {
            Ok(_) => {
                if let Err(error) = self.inject_fault("after_release") {
                    self.record_maintenance_failure(&error, false);
                }
            }
            Err(error) => self.record_maintenance_failure(&error, false),
        }
        #[cfg(test)]
        if let Some(barrier) = &self.after_release_barrier {
            barrier.wait();
            barrier.wait();
        }
        if let Some(error) = strict_failure {
            return Err(error);
        }
        Ok(value)
    }

    fn read_authoritative_state(&mut self) -> LockResult<OperationState> {
        self.ensure_paths()?;
        for _ in 0..READ_RETRY_LIMIT {
            let entries = match fs::read_dir(&self.paths.state_records) {
                Ok(entries) => entries,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(LockError::io("read state records", error)),
            };
            let mut enumerated = Vec::new();
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {
                        enumerated.clear();
                        break;
                    }
                    Err(error) => return Err(LockError::io("read state entry", error)),
                };
                let name = entry.file_name().to_string_lossy().into_owned();
                let revision = parse_state_filename(&name).ok_or_else(|| {
                    LockError::new("STATE_CORRUPTION", format!("unexpected state entry {name}"))
                })?;
                enumerated.push((revision, entry.path()));
            }
            if enumerated.is_empty() {
                if fs::read_dir(&self.paths.state_records)
                    .map_err(|error| LockError::io("confirm empty state records", error))?
                    .next()
                    .is_none()
                {
                    return self.initial_state();
                }
                continue;
            }

            enumerated.sort_by_key(|(revision, _)| *revision);
            #[cfg(test)]
            if self.read_turnover_once && enumerated.len() > 1 {
                self.read_turnover_once = false;
                fs::remove_file(&enumerated[0].1)
                    .map_err(|error| LockError::io("inject state turnover", error))?;
            }

            let mut records = Vec::new();
            let mut retry = false;
            for (revision, path) in enumerated {
                match assert_private_regular_file(&path)
                    .and_then(|()| read_json::<OperationState>(&path, "operation state"))
                {
                    Ok(state) => {
                        validate_state(&state, &self.database_identity)?;
                        if revision != state.state_revision {
                            return Err(LockError::new(
                                "STATE_CORRUPTION",
                                "state filename revision mismatch",
                            ));
                        }
                        records.push(state);
                    }
                    Err(error) if error.code == "NOT_FOUND" => {
                        retry = true;
                        break;
                    }
                    Err(error) => return Err(error),
                }
            }
            if retry {
                continue;
            }
            records.sort_by_key(|state| state.state_revision);
            for pair in records.windows(2) {
                if pair[0].state_revision == pair[1].state_revision {
                    return Err(LockError::new(
                        "STATE_CORRUPTION",
                        "duplicate operation-state revision",
                    ));
                }
                if pair[1].fencing_generation_high_water < pair[0].fencing_generation_high_water {
                    return Err(LockError::new(
                        "STATE_CORRUPTION",
                        "fencing high-water decreased across records",
                    ));
                }
            }
            return records
                .pop()
                .ok_or_else(|| LockError::new("STATE_CORRUPTION", "missing highest state"));
        }
        Err(LockError::new(
            "STATE_READ_RACE",
            "state changed during every bounded read",
        ))
    }

    fn initial_state(&mut self) -> LockResult<OperationState> {
        Ok(OperationState {
            protocol: PROTOCOL.into(),
            protocol_version: PROTOCOL_VERSION,
            record_kind: OperationStateKind::OperationState,
            database_identity: self.database_identity.clone(),
            state_revision: 0,
            fencing_generation_high_water: 0,
            leases: Vec::new(),
            exclusive_intent: None,
            updated_by: self.ensure_owner()?,
            updated_at: format_timestamp(self.now_ms()?)?,
        })
    }

    fn acquire_mutex(&mut self) -> LockResult<MutexGuard> {
        self.ensure_owner()?;
        let deadline = Instant::now() + StdDuration::from_millis(self.timing.acquire_timeout_ms);
        loop {
            let existing = inspect_mutex(
                &self.paths.registration_mutex,
                &self.database_identity,
                self.timing.mutex_ttl_ms,
            )?;
            let now = self.now_ms()?;
            let stale = match &existing {
                MutexInspection::Complete { record, .. } => Some(expired(&record.expires_at, now)?),
                MutexInspection::Incomplete { stale_at_ms, .. } => Some(now >= *stale_at_ms),
                MutexInspection::Absent | MutexInspection::Retry => None,
            };
            if let Some(stale) = stale {
                if stale && self.quarantine_stale_mutex(&existing)? {
                    continue;
                }
                if Instant::now() >= deadline {
                    return Err(LockError::new(
                        "MUTEX_BUSY",
                        "timed out waiting for registration mutex",
                    ));
                }
                thread::sleep(StdDuration::from_millis(10));
                continue;
            }

            let mutex_id = Uuid::new_v4().to_string();
            let candidate = self
                .paths
                .operation_root
                .join(format!(".candidate-mutex-{mutex_id}-{}", Uuid::new_v4()));
            fs::create_dir(&candidate)
                .map_err(|error| LockError::io("create mutex candidate", error))?;
            set_private_dir_mode(&candidate)?;
            let candidate_token = candidate.join(format!("token-{mutex_id}"));
            fs::create_dir(&candidate_token)
                .map_err(|error| LockError::io("create mutex candidate token", error))?;
            set_private_dir_mode(&candidate_token)?;
            let now = self.now_ms()?;
            let record = RegistrationMutex {
                protocol: PROTOCOL.into(),
                protocol_version: PROTOCOL_VERSION,
                record_kind: RegistrationMutexKind::RegistrationMutex,
                database_identity: self.database_identity.clone(),
                mutex_id,
                owner: self.ensure_owner()?,
                acquired_at: format_timestamp(now)?,
                expires_at: format_timestamp(now + i128::from(self.timing.mutex_ttl_ms))?,
                ttl_ms: self.timing.mutex_ttl_ms,
            };
            // write_json_exclusive fsyncs mutex.json and its token directory; syncing the
            // candidate then makes the complete token child durable before publication.
            write_json_exclusive(&candidate_token.join("mutex.json"), &record)?;
            sync_directory(&candidate)?;
            self.inject_fault("before_mutex_publication")?;

            let published = match fs::rename(&candidate, &self.paths.registration_mutex) {
                Ok(()) => true,
                Err(error)
                    if is_directory_rename_collision(&error, &self.paths.registration_mutex) =>
                {
                    fs::remove_dir_all(&candidate)
                        .map_err(|error| LockError::io("discard mutex candidate", error))?;
                    false
                }
                Err(error) => {
                    return Err(LockError::io("publish registration mutex", error));
                }
            };
            if published {
                sync_directory(&self.paths.operation_root)?;
                self.inject_fault("after_mutex_publication")?;
                let token_path = self
                    .paths
                    .registration_mutex
                    .join(format!("token-{}", record.mutex_id));
                let guard = MutexGuard { record, token_path };
                self.revalidate_mutex(&guard)?;
                return Ok(guard);
            }

            if Instant::now() >= deadline {
                return Err(LockError::new(
                    "MUTEX_BUSY",
                    "timed out waiting for registration mutex",
                ));
            }
            thread::sleep(StdDuration::from_millis(10));
        }
    }

    fn revalidate_mutex(&self, guard: &MutexGuard) -> LockResult<()> {
        match inspect_mutex(
            &self.paths.registration_mutex,
            &self.database_identity,
            self.timing.mutex_ttl_ms,
        )? {
            MutexInspection::Complete {
                record, token_path, ..
            } if token_path == guard.token_path
                && same_mutex_authority(&record, &guard.record)
                && !expired(&record.expires_at, self.now_ms()?)? =>
            {
                Ok(())
            }
            _ => Err(LockError::new(
                "MUTEX_FENCED",
                "registration mutex expired, disappeared, or was superseded",
            )),
        }
    }

    fn stage_state(&self, guard: &MutexGuard, state: &OperationState) -> LockResult<PathBuf> {
        let path = guard
            .token_path
            .join(format!("staged-state-{}.json", Uuid::new_v4()));
        write_json_exclusive(&path, state)?;
        Ok(path)
    }

    fn rename_staged_state(
        &self,
        guard: &MutexGuard,
        staged_path: &Path,
        revision: u64,
    ) -> LockResult<PathBuf> {
        self.revalidate_mutex(guard)?;
        let destination = self.paths.state_records.join(format!(
            "operation-state-{revision:020}-{}.json",
            Uuid::new_v4()
        ));
        fs::rename(staged_path, &destination)
            .map_err(|error| LockError::io("publish operation state", error))?;
        Ok(destination)
    }

    fn publish_staged_state(
        &self,
        guard: &MutexGuard,
        staged_path: &Path,
        revision: u64,
    ) -> LockResult<PathBuf> {
        let destination = self.rename_staged_state(guard, staged_path, revision)?;
        sync_directory(&self.paths.state_records)?;
        Ok(destination)
    }

    fn release_mutex(&self, guard: &MutexGuard) -> LockResult<bool> {
        let inspection = inspect_mutex(
            &self.paths.registration_mutex,
            &self.database_identity,
            self.timing.mutex_ttl_ms,
        )?;
        let MutexInspection::Complete {
            record, token_path, ..
        } = inspection
        else {
            return Ok(false);
        };
        if token_path != guard.token_path
            || !same_mutex_authority(&record, &guard.record)
            || expired(&record.expires_at, self.now_ms()?)?
        {
            return Ok(false);
        }
        let quarantine = self.paths.operation_root.join(format!(
            ".quarantine-release-{}-{}",
            guard.record.mutex_id,
            Uuid::new_v4()
        ));
        match fs::rename(&self.paths.registration_mutex, &quarantine) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(LockError::io("quarantine released mutex", error)),
        }
        #[cfg(test)]
        if let Some(barrier) = &self.release_quarantine_barrier {
            barrier.wait();
            barrier.wait();
        }
        let moved = inspect_mutex(
            &quarantine,
            &self.database_identity,
            self.timing.mutex_ttl_ms,
        )?;
        if !matches!(
            moved,
            MutexInspection::Complete { ref record, .. }
                if same_mutex_authority(record, &guard.record)
        ) {
            restore_quarantine(&quarantine, &self.paths.registration_mutex)?;
            return Ok(false);
        }
        fs::remove_dir_all(&quarantine)
            .map_err(|error| LockError::io("delete released mutex quarantine", error))?;
        sync_directory(&self.paths.operation_root)?;
        Ok(true)
    }

    fn quarantine_stale_mutex(&self, expected: &MutexInspection) -> LockResult<bool> {
        let expected_metadata = match expected {
            MutexInspection::Incomplete { metadata, .. }
            | MutexInspection::Complete { metadata, .. } => metadata,
            MutexInspection::Absent | MutexInspection::Retry => return Ok(false),
        };
        let quarantine = self
            .paths
            .operation_root
            .join(format!(".quarantine-stale-{}", Uuid::new_v4()));
        match fs::rename(&self.paths.registration_mutex, &quarantine) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(LockError::io("quarantine stale mutex", error)),
        }
        let moved_metadata = fs::symlink_metadata(&quarantine)
            .map_err(|error| LockError::io("inspect mutex quarantine", error))?;
        let stable_identity = same_file_identity(expected_metadata, &moved_metadata);
        if stable_identity == Some(false) {
            restore_quarantine_if_possible(&quarantine, &self.paths.registration_mutex)?;
            return Ok(false);
        }
        let moved = inspect_mutex(
            &quarantine,
            &self.database_identity,
            self.timing.mutex_ttl_ms,
        )?;
        let now = self.now_ms()?;
        let removable = match (expected, &moved) {
            (
                MutexInspection::Complete {
                    record: expected_record,
                    ..
                },
                MutexInspection::Complete {
                    record: moved_record,
                    ..
                },
            ) => {
                stable_identity != Some(false)
                    && same_mutex_authority(expected_record, moved_record)
                    && expired(&moved_record.expires_at, now)?
            }
            (
                MutexInspection::Incomplete { .. },
                MutexInspection::Incomplete { stale_at_ms, .. },
            ) => stable_identity == Some(true) && now >= *stale_at_ms,
            _ => false,
        };
        if !removable {
            restore_quarantine_if_possible(&quarantine, &self.paths.registration_mutex)?;
            return Ok(false);
        }
        fs::remove_dir_all(&quarantine)
            .map_err(|error| LockError::io("delete stale mutex quarantine", error))?;
        sync_directory(&self.paths.operation_root)?;
        Ok(true)
    }

    fn prune_for_publication(&self) -> LockResult<()> {
        let mut records = Vec::new();
        for entry in fs::read_dir(&self.paths.state_records)
            .map_err(|error| LockError::io("read state records for pruning", error))?
        {
            let entry = entry.map_err(|error| LockError::io("read state entry", error))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let revision = parse_state_filename(&name).ok_or_else(|| {
                LockError::new("STATE_CORRUPTION", format!("unexpected state entry {name}"))
            })?;
            records.push((revision, name, entry.path()));
        }
        records.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
        let retain_before_publication = self.max_state_records.saturating_sub(1).max(1);
        let should_sync = records.len() > retain_before_publication;
        for (_, _, path) in records.into_iter().skip(retain_before_publication) {
            assert_private_regular_file(&path)?;
            fs::remove_file(path).map_err(|error| LockError::io("prune operation state", error))?;
        }
        if should_sync {
            sync_directory(&self.paths.state_records)?;
        }
        Ok(())
    }
}

fn mutation_entry_binding(
    state: &OperationState,
    evidence: &ExclusiveIntent,
    operation_root: &Path,
) -> LockResult<JournalIntentBinding> {
    let current = state
        .exclusive_intent
        .as_ref()
        .ok_or_else(|| LockError::new("INTENT_FENCED", "intent is absent"))?;
    if !same_intent_authority(current, evidence) {
        return Err(LockError::new(
            "INTENT_FENCED",
            "intent authority no longer matches",
        ));
    }
    if current.phase != ExclusivePhase::Exclusive {
        return Err(LockError::new(
            "INTENT_PHASE_INVALID",
            "persisted intent phase cannot begin mutation",
        ));
    }
    if !state.leases.is_empty() {
        return Err(LockError::new(
            "RUNTIME_LEASES_ACTIVE",
            "leases must drain before mutation",
        ));
    }
    if current.fencing_generation != state.fencing_generation_high_water {
        return Err(LockError::new(
            "INTENT_FENCED",
            "intent is not high-water owner",
        ));
    }
    if state.state_revision >= MAX_JSON_SAFE_INTEGER {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            "state revision cannot advance safely",
        ));
    }
    if operation_root.as_os_str().is_empty() {
        return Err(LockError::new(
            "INVALID_OPTIONS",
            "operation root is unavailable",
        ));
    }
    JournalIntentBinding::new(
        SHIKIN_DATABASE_IDENTITY.into(),
        state.state_revision,
        current.operation_id.clone(),
        match current.operation {
            DatabaseOperation::Restore => JournalRecoveryOperation::Restore,
            DatabaseOperation::Import => JournalRecoveryOperation::Import,
        },
        JournalOwnerEvidence::new(
            current.owner.owner_id.clone(),
            match current.owner.runtime_id {
                RuntimeId::Cli => JournalRuntimeId::Cli,
                RuntimeId::Mcp => JournalRuntimeId::Mcp,
                RuntimeId::BrowserDataServer => JournalRuntimeId::BrowserDataServer,
                RuntimeId::Tauri => JournalRuntimeId::Tauri,
            },
            current.owner.host_id.clone(),
            current.owner.process_id,
            current.owner.process_started_at.clone(),
        )
        .map_err(LockError::from_recovery_journal)?,
        current.fencing_generation,
        JournalIntentPhase::Exclusive,
        current.created_at.clone(),
        current.updated_at.clone(),
        current.metadata.clone().map(JsonValue::Object),
    )
    .map_err(LockError::from_recovery_journal)
}

fn require_intent<'a>(
    state: &'a mut OperationState,
    evidence: &ExclusiveIntent,
    phases: &[ExclusivePhase],
) -> LockResult<&'a mut ExclusiveIntent> {
    let current = state
        .exclusive_intent
        .as_mut()
        .ok_or_else(|| LockError::new("INTENT_FENCED", "intent is absent"))?;
    if !same_intent_authority(current, evidence) || !phases.contains(&current.phase) {
        return Err(LockError::new(
            "INTENT_FENCED",
            "intent authority or phase changed",
        ));
    }
    Ok(current)
}

fn validate_timing(timing: Timing) -> LockResult<()> {
    if !(MUTEX_MIN_TTL_MS..=MUTEX_MAX_TTL_MS).contains(&timing.mutex_ttl_ms) {
        return Err(LockError::new(
            "INVALID_TIMING",
            "mutex TTL violates contract",
        ));
    }
    if !(LEASE_MIN_TTL_MS..=LEASE_MAX_TTL_MS).contains(&timing.lease_ttl_ms) {
        return Err(LockError::new(
            "INVALID_TIMING",
            "lease TTL violates contract",
        ));
    }
    if timing.heartbeat_interval_ms < HEARTBEAT_MIN_MS
        || u128::from(timing.heartbeat_interval_ms) * 3 >= u128::from(timing.lease_ttl_ms)
    {
        return Err(LockError::new(
            "INVALID_TIMING",
            "heartbeat interval violates contract",
        ));
    }
    Ok(())
}

fn increment_authority(value: u64, label: &str) -> LockResult<u64> {
    if value >= MAX_JSON_SAFE_INTEGER {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            format!("{label} cannot exceed the JSON safe-integer limit"),
        ));
    }
    Ok(value + 1)
}

fn increment_cancellation_counter(value: u64, label: &str) -> LockResult<u64> {
    if value >= MAX_JSON_SAFE_INTEGER {
        return Err(LockError::new(
            "COUNTER_OVERFLOW",
            format!("{label} cannot exceed the JSON safe-integer limit"),
        ));
    }
    Ok(value + 1)
}

fn validate_state(state: &OperationState, identity: &str) -> LockResult<()> {
    if state.protocol != PROTOCOL
        || state.protocol_version != PROTOCOL_VERSION
        || state.database_identity != identity
        || state.state_revision > MAX_JSON_SAFE_INTEGER
        || state.fencing_generation_high_water > MAX_JSON_SAFE_INTEGER
        || !valid_timestamp(&state.updated_at)
    {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            "operation state is malformed",
        ));
    }
    validate_owner(&state.updated_by)?;
    let mut lease_ids = HashSet::new();
    let mut owner_ids = HashSet::new();
    for lease in &state.leases {
        validate_lease(lease)?;
        if lease.fencing_generation > state.fencing_generation_high_water
            || !lease_ids.insert(&lease.lease_id)
            || !owner_ids.insert(&lease.owner.owner_id)
        {
            return Err(LockError::new(
                "STATE_CORRUPTION",
                "lease uniqueness or fencing invariant failed",
            ));
        }
    }
    if let Some(intent) = &state.exclusive_intent {
        validate_intent(intent)?;
        validate_recovery_commitment_metadata(intent, Some(state.state_revision))?;
        if intent.fencing_generation > state.fencing_generation_high_water {
            return Err(LockError::new(
                "STATE_CORRUPTION",
                "intent generation exceeds high-water",
            ));
        }
        if matches!(
            intent.phase,
            ExclusivePhase::Exclusive
                | ExclusivePhase::Mutating
                | ExclusivePhase::Completed
                | ExclusivePhase::Abandoned
        ) && !state.leases.is_empty()
        {
            return Err(LockError::new(
                "STATE_CORRUPTION",
                "exclusive phase requires empty leases",
            ));
        }
    }
    Ok(())
}

fn validate_lease(lease: &RuntimeLease) -> LockResult<()> {
    validate_bounded(&lease.lease_id, 1, 128, "leaseId")?;
    validate_owner(&lease.owner)?;
    if lease.fencing_generation == 0
        || lease.fencing_generation > MAX_JSON_SAFE_INTEGER
        || lease.ttl_ms > MAX_JSON_SAFE_INTEGER
        || !(LEASE_MIN_TTL_MS..=LEASE_MAX_TTL_MS).contains(&lease.ttl_ms)
        || !valid_timestamp(&lease.acquired_at)
        || !valid_timestamp(&lease.heartbeat_at)
        || !valid_timestamp(&lease.expires_at)
    {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            "runtime lease is malformed",
        ));
    }
    Ok(())
}

fn validate_intent(intent: &ExclusiveIntent) -> LockResult<()> {
    validate_bounded(&intent.operation_id, 1, 128, "operationId")?;
    validate_owner(&intent.owner)?;
    if intent.fencing_generation == 0
        || intent.fencing_generation > MAX_JSON_SAFE_INTEGER
        || !valid_timestamp(&intent.created_at)
        || !valid_timestamp(&intent.updated_at)
        || intent
            .completed_at
            .as_ref()
            .is_some_and(|value| !valid_timestamp(value))
        || (intent.phase == ExclusivePhase::Completed && intent.completed_at.is_none())
    {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            "exclusive intent is malformed",
        ));
    }
    validate_recovery_commitment_metadata(intent, None)?;
    Ok(())
}

const RECOVERY_COMMITMENT_KEYS: [&str; 5] = [
    "recovery.protocol",
    "recovery.operationId",
    "recovery.stateRevision",
    "recovery.fencingGeneration",
    "recovery.commitmentSha256",
];

fn validate_recovery_commitment_metadata(
    intent: &ExclusiveIntent,
    containing_state_revision: Option<u64>,
) -> LockResult<bool> {
    let Some(metadata) = &intent.metadata else {
        return Ok(false);
    };
    let recovery_keys: Vec<&String> = metadata
        .keys()
        .filter(|key| key.starts_with("recovery."))
        .collect();
    if recovery_keys.is_empty() {
        return Ok(false);
    }
    if !matches!(
        intent.phase,
        ExclusivePhase::Mutating | ExclusivePhase::Completed
    ) {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            "recovery commitment metadata is forbidden before mutation",
        ));
    }
    let state_revision = metadata
        .get("recovery.stateRevision")
        .and_then(JsonValue::as_u64);
    let fencing_generation = metadata
        .get("recovery.fencingGeneration")
        .and_then(JsonValue::as_u64);
    let commitment = metadata
        .get("recovery.commitmentSha256")
        .and_then(JsonValue::as_str);
    if recovery_keys.len() != RECOVERY_COMMITMENT_KEYS.len()
        || !RECOVERY_COMMITMENT_KEYS
            .iter()
            .all(|key| metadata.contains_key(*key))
        || metadata
            .get("recovery.protocol")
            .and_then(JsonValue::as_str)
            != Some(RECOVERY_JOURNAL_PROTOCOL)
        || metadata
            .get("recovery.operationId")
            .and_then(JsonValue::as_str)
            != Some(intent.operation_id.as_str())
        || state_revision.is_none_or(|revision| revision > MAX_JSON_SAFE_INTEGER)
        || fencing_generation != Some(intent.fencing_generation)
        || commitment.is_none_or(|value| {
            value.len() != 64
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
    {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            "recovery commitment metadata is malformed",
        ));
    }
    if let Some(containing) = containing_state_revision {
        let advance = if intent.phase == ExclusivePhase::Mutating {
            1
        } else {
            2
        };
        if state_revision.and_then(|revision| revision.checked_add(advance)) != Some(containing) {
            return Err(LockError::new(
                "STATE_CORRUPTION",
                "recovery commitment state revision does not bind the persisted transition",
            ));
        }
    }
    Ok(true)
}

fn validate_caller_intent_metadata(
    metadata: Option<&JsonMap<String, JsonValue>>,
) -> LockResult<()> {
    let Some(metadata) = metadata else {
        return Ok(());
    };
    if let Some(key) = metadata.keys().find(|key| key.starts_with("recovery.")) {
        return Err(LockError::new(
            "RESERVED_METADATA_KEY",
            format!("intent metadata key {key} is reserved"),
        ));
    }
    validate_canonical_metadata_value(&JsonValue::Object(metadata.clone()))
}

fn validate_canonical_metadata_value(value: &JsonValue) -> LockResult<()> {
    match value {
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::String(_) => Ok(()),
        JsonValue::Number(number)
            if number
                .as_u64()
                .is_some_and(|value| value <= MAX_JSON_SAFE_INTEGER)
                || number
                    .as_i64()
                    .is_some_and(|value| value.unsigned_abs() <= MAX_JSON_SAFE_INTEGER) =>
        {
            Ok(())
        }
        JsonValue::Array(values) => {
            for value in values {
                validate_canonical_metadata_value(value)?;
            }
            Ok(())
        }
        JsonValue::Object(values) => {
            for value in values.values() {
                validate_canonical_metadata_value(value)?;
            }
            Ok(())
        }
        _ => Err(LockError::new(
            "INVALID_OPTIONS",
            "intent metadata is not canonical JSON",
        )),
    }
}

fn metadata_with_recovery_commitment(
    metadata: Option<JsonMap<String, JsonValue>>,
    binding: &JournalIntentBinding,
    commitment: &PreparedCommitment,
) -> JsonMap<String, JsonValue> {
    let mut metadata = metadata.unwrap_or_default();
    metadata.insert(
        "recovery.protocol".into(),
        JsonValue::String(RECOVERY_JOURNAL_PROTOCOL.into()),
    );
    metadata.insert(
        "recovery.operationId".into(),
        JsonValue::String(binding.operation_id().into()),
    );
    metadata.insert(
        "recovery.stateRevision".into(),
        JsonValue::from(binding.state_revision()),
    );
    metadata.insert(
        "recovery.fencingGeneration".into(),
        JsonValue::from(binding.fencing_generation()),
    );
    metadata.insert(
        "recovery.commitmentSha256".into(),
        JsonValue::String(commitment.sha256().into()),
    );
    metadata
}

fn validate_mutex(mutex: &RegistrationMutex, identity: &str) -> LockResult<()> {
    validate_bounded(&mutex.mutex_id, 1, 128, "mutexId")?;
    validate_owner(&mutex.owner)?;
    if mutex.protocol != PROTOCOL
        || mutex.protocol_version != PROTOCOL_VERSION
        || mutex.database_identity != identity
        || mutex.ttl_ms > MAX_JSON_SAFE_INTEGER
        || !(MUTEX_MIN_TTL_MS..=MUTEX_MAX_TTL_MS).contains(&mutex.ttl_ms)
        || !valid_timestamp(&mutex.acquired_at)
        || !valid_timestamp(&mutex.expires_at)
    {
        return Err(LockError::new(
            "MUTEX_CORRUPTION",
            "registration mutex is malformed",
        ));
    }
    Ok(())
}

fn validate_owner(owner: &OwnerEvidence) -> LockResult<()> {
    validate_bounded(&owner.owner_id, 1, 128, "ownerId")?;
    validate_bounded(&owner.host_id, 1, 128, "hostId")?;
    if owner.process_id == 0 || !valid_timestamp(&owner.process_started_at) {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            "owner evidence is malformed",
        ));
    }
    Ok(())
}

fn validate_bounded(value: &str, minimum: usize, maximum: usize, label: &str) -> LockResult<()> {
    if value.len() < minimum || value.len() > maximum {
        Err(LockError::new(
            "INVALID_OPTIONS",
            format!("{label} is outside its UTF-8 byte contract bounds"),
        ))
    } else {
        Ok(())
    }
}

fn inspect_mutex(
    path: &Path,
    identity: &str,
    incomplete_ttl_ms: u64,
) -> LockResult<MutexInspection> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(MutexInspection::Absent)
        }
        Err(error) => return Err(LockError::io("inspect mutex", error)),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(LockError::new(
            "MUTEX_CORRUPTION",
            "mutex is not a directory",
        ));
    }
    let entries = match read_entry_names(path) {
        Ok(entries) => entries,
        Err(error) if error.code == "NOT_FOUND" => return Ok(MutexInspection::Retry),
        Err(error) => return Err(error),
    };
    if entries.is_empty() {
        return Ok(MutexInspection::Incomplete {
            stale_at_ms: modified_ms(&metadata)? + i128::from(incomplete_ttl_ms),
            metadata,
        });
    }
    if entries.len() != 1 || !is_token_directory(&entries[0]) {
        return Err(LockError::new(
            "MUTEX_CORRUPTION",
            "mutex directory has unexpected entries",
        ));
    }
    let token_path = path.join(&entries[0]);
    let token_metadata = match fs::symlink_metadata(&token_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(MutexInspection::Retry),
        Err(error) => return Err(LockError::io("inspect mutex token", error)),
    };
    if !token_metadata.is_dir() || token_metadata.file_type().is_symlink() {
        return Err(LockError::new("MUTEX_CORRUPTION", "mutex token is unsafe"));
    }
    let token_entries = match read_entry_names(&token_path) {
        Ok(entries) => entries,
        Err(error) if error.code == "NOT_FOUND" => return Ok(MutexInspection::Retry),
        Err(error) => return Err(error),
    };
    if token_entries.iter().any(|name| {
        name != "mutex.json" && !is_staged_filename(name) && !is_staged_mutex_filename(name)
    }) {
        return Err(LockError::new(
            "MUTEX_CORRUPTION",
            "mutex token has unexpected entries",
        ));
    }
    if !token_entries.iter().any(|name| name == "mutex.json") {
        return Ok(MutexInspection::Incomplete {
            stale_at_ms: modified_ms(&metadata)? + i128::from(incomplete_ttl_ms),
            metadata,
        });
    }
    let mutex_path = token_path.join("mutex.json");
    match assert_private_regular_file(&mutex_path) {
        Ok(()) => {}
        Err(error) if error.code == "NOT_FOUND" => return Ok(MutexInspection::Retry),
        Err(error) => return Err(error),
    }
    let record: RegistrationMutex = match read_json(&mutex_path, "registration mutex") {
        Ok(record) => record,
        Err(error) if error.code == "NOT_FOUND" => return Ok(MutexInspection::Retry),
        Err(error) => return Err(error),
    };
    validate_mutex(&record, identity)?;
    if entries[0] != format!("token-{}", record.mutex_id) {
        return Err(LockError::new(
            "MUTEX_CORRUPTION",
            "mutex token path does not match mutexId",
        ));
    }
    Ok(MutexInspection::Complete {
        metadata,
        record: Box::new(record),
        token_path,
    })
}

fn read_or_create_host_identity(path: &Path) -> LockResult<String> {
    let parent = path
        .parent()
        .ok_or_else(|| LockError::new("UNSAFE_PATH", "host identity has no parent"))?;
    for _ in 0..READ_RETRY_LIMIT {
        match fs::symlink_metadata(path) {
            Ok(_) => {
                assert_private_regular_file(path).map_err(|error| {
                    LockError::new(
                        "HOST_ID_CORRUPTION",
                        format!("stable host identity is unsafe: {error}"),
                    )
                })?;
                let record = read_json::<HostIdentity>(path, "host identity").map_err(|error| {
                    LockError::new(
                        "HOST_ID_CORRUPTION",
                        format!("stable host identity is malformed: {error}"),
                    )
                })?;
                validate_bounded(&record.host_id, 1, 128, "hostId")
                    .map_err(|error| LockError::new("HOST_ID_CORRUPTION", error.to_string()))?;
                return Ok(record.host_id);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let record = HostIdentity {
                    host_id: Uuid::new_v4().to_string(),
                };
                let staged = parent.join(format!(".machine-host-identity-{}.json", Uuid::new_v4()));
                write_json_exclusive(&staged, &record)?;
                let link_result = fs::hard_link(&staged, path);
                let _ = fs::remove_file(&staged);
                match link_result {
                    Ok(()) => {
                        sync_directory(parent)?;
                        return Ok(record.host_id);
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(LockError::io("publish host identity", error)),
                }
            }
            Err(error) => return Err(LockError::io("inspect host identity", error)),
        }
    }
    Err(LockError::new(
        "HOST_ID_CORRUPTION",
        "host identity could not converge",
    ))
}

fn owner_demonstrably_dead(
    _paths: &LockPaths,
    current_host_id: &str,
    owner: &OwnerEvidence,
) -> LockResult<bool> {
    if owner.host_id != current_host_id {
        return Ok(false);
    }
    #[cfg(target_os = "linux")]
    {
        match linux_process_started_at(owner.process_id) {
            Ok(started_at) => Ok(started_at != owner.process_started_at),
            Err(error) if error.code == "PROCESS_NOT_FOUND" => Ok(true),
            Err(error) => Err(error),
        }
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        unix_process_demonstrably_absent(owner.process_id)
    }
    #[cfg(windows)]
    {
        windows_process_demonstrably_absent(owner.process_id)
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err(LockError::new(
            "PROCESS_EVIDENCE_UNSUPPORTED",
            "process liveness evidence is unavailable on this platform",
        ))
    }
}

fn current_process_started_at() -> LockResult<String> {
    #[cfg(target_os = "linux")]
    {
        linux_process_started_at(std::process::id())
    }
    #[cfg(not(target_os = "linux"))]
    {
        format_timestamp(system_time_ms()?)
    }
}

#[cfg(target_os = "linux")]
fn linux_process_started_at(process_id: u32) -> LockResult<String> {
    let source = match fs::read_to_string(format!("/proc/{process_id}/stat")) {
        Ok(source) => source,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(LockError::new(
                "PROCESS_NOT_FOUND",
                "process does not exist",
            ));
        }
        Err(error) => return Err(LockError::io("read Linux process stat", error)),
    };
    let closing = source
        .rfind(')')
        .ok_or_else(|| LockError::new("PROCESS_EVIDENCE_UNAVAILABLE", "malformed process stat"))?;
    let fields: Vec<&str> = source[closing + 1..].split_whitespace().collect();
    let start_ticks = fields
        .get(19)
        .ok_or_else(|| LockError::new("PROCESS_EVIDENCE_UNAVAILABLE", "missing start ticks"))?
        .parse::<i128>()
        .map_err(|error| LockError::new("PROCESS_EVIDENCE_UNAVAILABLE", error.to_string()))?;
    let boot_source = fs::read_to_string("/proc/stat")
        .map_err(|error| LockError::io("read Linux boot time", error))?;
    let boot_seconds = boot_source
        .lines()
        .find_map(|line| line.strip_prefix("btime "))
        .ok_or_else(|| LockError::new("PROCESS_EVIDENCE_UNAVAILABLE", "missing boot time"))?
        .parse::<i128>()
        .map_err(|error| LockError::new("PROCESS_EVIDENCE_UNAVAILABLE", error.to_string()))?;
    let ticks = Command::new("getconf")
        .arg("CLK_TCK")
        .output()
        .map_err(|error| LockError::io("run getconf CLK_TCK", error))?;
    if !ticks.status.success() {
        return Err(LockError::new(
            "PROCESS_EVIDENCE_UNAVAILABLE",
            "getconf CLK_TCK failed",
        ));
    }
    let ticks_per_second = String::from_utf8(ticks.stdout)
        .map_err(|error| LockError::new("PROCESS_EVIDENCE_UNAVAILABLE", error.to_string()))?
        .trim()
        .parse::<i128>()
        .map_err(|error| LockError::new("PROCESS_EVIDENCE_UNAVAILABLE", error.to_string()))?;
    if ticks_per_second < 1 {
        return Err(LockError::new(
            "PROCESS_EVIDENCE_UNAVAILABLE",
            "invalid clock tick rate",
        ));
    }
    format_timestamp(boot_seconds * 1_000 + (start_ticks * 1_000 / ticks_per_second))
}

#[cfg(all(unix, not(target_os = "linux")))]
fn unix_process_demonstrably_absent(process_id: u32) -> LockResult<bool> {
    let Ok(process_id) = i32::try_from(process_id) else {
        return Ok(true);
    };
    // SAFETY: kill(pid, 0) sends no signal and only probes kernel process visibility.
    let result = unsafe { libc::kill(process_id, 0) };
    if result == 0 {
        return Ok(false);
    }
    match io::Error::last_os_error().raw_os_error() {
        Some(libc::ESRCH) => Ok(true),
        Some(libc::EPERM) => Ok(false),
        _ => Err(LockError::new(
            "PROCESS_EVIDENCE_UNAVAILABLE",
            "could not conservatively inspect process liveness",
        )),
    }
}

#[cfg(windows)]
fn windows_process_demonstrably_absent(process_id: u32) -> LockResult<bool> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER, STILL_ACTIVE},
        System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };

    // SAFETY: OpenProcess/GetExitCodeProcess/CloseHandle are called with a PID and owned handle.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if handle.is_null() {
        return match io::Error::last_os_error()
            .raw_os_error()
            .map(|value| value as u32)
        {
            Some(ERROR_INVALID_PARAMETER) => Ok(true),
            Some(ERROR_ACCESS_DENIED) => Ok(false),
            _ => Err(LockError::new(
                "PROCESS_EVIDENCE_UNAVAILABLE",
                "could not conservatively open process for liveness inspection",
            )),
        };
    }
    let mut exit_code = 0_u32;
    let read = unsafe { GetExitCodeProcess(handle, &mut exit_code) };
    unsafe { CloseHandle(handle) };
    if read == 0 {
        return Err(LockError::new(
            "PROCESS_EVIDENCE_UNAVAILABLE",
            "could not read process liveness",
        ));
    }
    Ok(exit_code != STILL_ACTIVE as u32)
}

fn same_owner(left: &OwnerEvidence, right: &OwnerEvidence) -> bool {
    left == right
}

fn same_lease_authority(left: &RuntimeLease, right: &RuntimeLease) -> bool {
    left.lease_id == right.lease_id
        && left.fencing_generation == right.fencing_generation
        && same_owner(&left.owner, &right.owner)
}

fn same_intent_authority(left: &ExclusiveIntent, right: &ExclusiveIntent) -> bool {
    left.operation_id == right.operation_id
        && left.fencing_generation == right.fencing_generation
        && same_owner(&left.owner, &right.owner)
}

fn same_mutex_authority(left: &RegistrationMutex, right: &RegistrationMutex) -> bool {
    left.database_identity == right.database_identity
        && left.mutex_id == right.mutex_id
        && left.expires_at == right.expires_at
        && same_owner(&left.owner, &right.owner)
}

fn ensure_canonical_private_root(path: &Path) -> LockResult<()> {
    if !path.exists() {
        let mut ancestor = path.parent().ok_or_else(|| {
            LockError::new("UNSAFE_PATH", "coordination root has no existing ancestor")
        })?;
        while !ancestor.exists() {
            ancestor = ancestor.parent().ok_or_else(|| {
                LockError::new("UNSAFE_PATH", "coordination root has no existing ancestor")
            })?;
        }
        assert_canonical_directory(ancestor)?;
        fs::create_dir_all(path)
            .map_err(|error| LockError::io("create coordination root", error))?;
    }
    assert_canonical_directory(path)?;
    set_private_dir_mode(path)
}

fn ensure_private_directory(path: &Path, canonical_root: &Path) -> LockResult<()> {
    fs::create_dir_all(path).map_err(|error| LockError::io("create private directory", error))?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| LockError::io("inspect private directory", error))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(LockError::new(
            "UNSAFE_PATH",
            "private path is not a directory",
        ));
    }
    let canonical = fs::canonicalize(path)
        .map_err(|error| LockError::io("canonicalize private directory", error))?;
    let root = fs::canonicalize(canonical_root)
        .map_err(|error| LockError::io("canonicalize coordination root", error))?;
    if canonical != root && !canonical.starts_with(&root) {
        return Err(LockError::new(
            "UNSAFE_PATH",
            "private path escapes coordination root",
        ));
    }
    set_private_dir_mode(path)
}

fn assert_canonical_directory(path: &Path) -> LockResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| LockError::io("inspect canonical directory", error))?;
    let canonical =
        fs::canonicalize(path).map_err(|error| LockError::io("canonicalize directory", error))?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || comparable_path(&canonical) != comparable_path(path)
    {
        return Err(LockError::new(
            "UNSAFE_PATH",
            "coordination root is noncanonical or traverses a symlink",
        ));
    }
    Ok(())
}

fn comparable_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        return value.strip_prefix(r"\\?\").unwrap_or(&value).to_lowercase();
    }
    #[cfg(not(windows))]
    value.into_owned()
}

fn absolute_lexical_path(path: PathBuf) -> LockResult<PathBuf> {
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|error| LockError::io("read current directory", error))?
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Ok(normalized)
}

fn set_private_dir_mode(path: &Path) -> LockResult<()> {
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(PRIVATE_DIR_MODE))
        .map_err(|error| LockError::io("set private directory mode", error))?;
    Ok(())
}

fn assert_private_regular_file(path: &Path) -> LockResult<()> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| LockError::io("inspect private file", error))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(LockError::new(
            "UNSAFE_PATH",
            "record is not a regular file",
        ));
    }
    #[cfg(unix)]
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err(LockError::new("UNSAFE_PATH", "record file is not private"));
    }
    Ok(())
}

fn write_json_exclusive<T: Serialize>(path: &Path, value: &T) -> LockResult<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(PRIVATE_FILE_MODE);
    let mut file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return Err(LockError::new("ALREADY_EXISTS", "record already exists"));
        }
        Err(error) => return Err(LockError::io("create record", error)),
    };
    serde_json::to_writer(&mut file, value)
        .map_err(|error| LockError::new("SERIALIZATION_FAILURE", error.to_string()))?;
    file.write_all(b"\n")
        .map_err(|error| LockError::io("write record newline", error))?;
    file.sync_all()
        .map_err(|error| LockError::io("fsync record", error))?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(PRIVATE_FILE_MODE))
        .map_err(|error| LockError::io("set private file mode", error))?;
    if let Some(parent) = path.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

fn read_json<T: DeserializeOwned>(path: &Path, label: &str) -> LockResult<T> {
    let metadata = fs::metadata(path).map_err(|error| LockError::io("stat JSON record", error))?;
    if metadata.len() == 0 || metadata.len() > 1024 * 1024 {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            format!("{label} has invalid size"),
        ));
    }
    let file = File::open(path).map_err(|error| LockError::io("open JSON record", error))?;
    let value: JsonValue = serde_json::from_reader(file)
        .map_err(|error| LockError::new("STATE_CORRUPTION", format!("invalid {label}: {error}")))?;
    parse_protocol_value(value, label)
}

fn parse_protocol_value<T: DeserializeOwned>(value: JsonValue, label: &str) -> LockResult<T> {
    validate_raw_json_shape(&value, label)?;
    serde_json::from_value(value)
        .map_err(|error| LockError::new("STATE_CORRUPTION", format!("invalid {label}: {error}")))
}

fn validate_raw_json_shape(value: &JsonValue, label: &str) -> LockResult<()> {
    let object = value
        .as_object()
        .ok_or_else(|| LockError::new("STATE_CORRUPTION", format!("{label} is not an object")))?;
    match label {
        "operation state" => {
            assert_raw_keys(
                object,
                &[
                    "protocol",
                    "protocolVersion",
                    "recordKind",
                    "databaseIdentity",
                    "stateRevision",
                    "fencingGenerationHighWater",
                    "leases",
                    "exclusiveIntent",
                    "updatedBy",
                    "updatedAt",
                ],
                &[],
                label,
            )?;
            validate_raw_json_shape(&object["updatedBy"], "owner evidence")?;
            let leases = object["leases"]
                .as_array()
                .ok_or_else(|| LockError::new("STATE_CORRUPTION", "leases must be an array"))?;
            for lease in leases {
                validate_raw_json_shape(lease, "runtime lease")?;
            }
            if !object["exclusiveIntent"].is_null() {
                validate_raw_json_shape(&object["exclusiveIntent"], "exclusive intent")?;
            }
        }
        "registration mutex" => {
            assert_raw_keys(
                object,
                &[
                    "protocol",
                    "protocolVersion",
                    "recordKind",
                    "databaseIdentity",
                    "mutexId",
                    "owner",
                    "acquiredAt",
                    "expiresAt",
                    "ttlMs",
                ],
                &[],
                label,
            )?;
            validate_raw_json_shape(&object["owner"], "owner evidence")?;
        }
        "runtime lease" => {
            assert_raw_keys(
                object,
                &[
                    "recordKind",
                    "leaseId",
                    "owner",
                    "fencingGeneration",
                    "acquiredAt",
                    "heartbeatAt",
                    "expiresAt",
                    "ttlMs",
                ],
                &[],
                label,
            )?;
            validate_raw_json_shape(&object["owner"], "owner evidence")?;
        }
        "exclusive intent" => {
            assert_raw_keys(
                object,
                &[
                    "recordKind",
                    "operationId",
                    "operation",
                    "phase",
                    "owner",
                    "fencingGeneration",
                    "createdAt",
                    "updatedAt",
                ],
                &["completedAt", "metadata"],
                label,
            )?;
            if object.get("completedAt").is_some_and(JsonValue::is_null)
                || object.get("metadata").is_some_and(JsonValue::is_null)
            {
                return Err(LockError::new(
                    "STATE_CORRUPTION",
                    "optional exclusive intent fields cannot be null",
                ));
            }
            validate_raw_json_shape(&object["owner"], "owner evidence")?;
        }
        "owner evidence" => assert_raw_keys(
            object,
            &[
                "ownerId",
                "runtimeId",
                "hostId",
                "processId",
                "processStartedAt",
            ],
            &[],
            label,
        )?,
        "host identity" => assert_raw_keys(object, &["hostId"], &[], label)?,
        _ => {}
    }
    Ok(())
}

fn assert_raw_keys(
    object: &JsonMap<String, JsonValue>,
    required: &[&str],
    optional: &[&str],
    label: &str,
) -> LockResult<()> {
    let all_allowed = |key: &str| required.contains(&key) || optional.contains(&key);
    if required.iter().any(|key| !object.contains_key(*key))
        || object.keys().any(|key| !all_allowed(key))
    {
        return Err(LockError::new(
            "STATE_CORRUPTION",
            format!("{label} has unknown or missing fields"),
        ));
    }
    Ok(())
}

fn sync_directory(path: &Path) -> LockResult<DirectorySync> {
    match File::open(path).and_then(|file| file.sync_all()) {
        Ok(()) => Ok(DirectorySync::Synced),
        Err(error) => classify_directory_sync_error(error),
    }
}

fn classify_directory_sync_error(error: io::Error) -> LockResult<DirectorySync> {
    if matches!(
        error.kind(),
        io::ErrorKind::InvalidInput | io::ErrorKind::PermissionDenied | io::ErrorKind::Unsupported
    ) {
        Ok(DirectorySync::Unsupported)
    } else {
        Err(LockError::io("fsync directory", error))
    }
}

fn restore_quarantine(quarantine: &Path, fixed: &Path) -> LockResult<()> {
    if restore_quarantine_if_possible(quarantine, fixed)? {
        Ok(())
    } else {
        Err(LockError::new(
            "MUTEX_FENCED",
            "cannot restore quarantined mutex over successor",
        ))
    }
}

fn restore_quarantine_if_possible(quarantine: &Path, fixed: &Path) -> LockResult<bool> {
    match fs::rename(quarantine, fixed) {
        Ok(()) => Ok(true),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::AlreadyExists | io::ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(false)
        }
        Err(error) if is_directory_rename_collision(&error, fixed) => Ok(false),
        Err(error) => Err(LockError::io("restore mutex quarantine", error)),
    }
}

fn is_directory_rename_collision(error: &io::Error, destination: &Path) -> bool {
    if matches!(
        error.kind(),
        io::ErrorKind::AlreadyExists | io::ErrorKind::DirectoryNotEmpty
    ) {
        return true;
    }
    error.kind() == io::ErrorKind::PermissionDenied
        && fs::symlink_metadata(destination)
            .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
}

fn read_entry_names(path: &Path) -> LockResult<Vec<String>> {
    fs::read_dir(path)
        .map_err(|error| LockError::io("read directory", error))?
        .map(|entry| {
            entry
                .map(|item| item.file_name().to_string_lossy().into_owned())
                .map_err(|error| LockError::io("read directory entry", error))
        })
        .collect()
}

fn parse_state_filename(name: &str) -> Option<u64> {
    let remainder = name.strip_prefix("operation-state-")?;
    let (revision, id) = remainder.split_once('-')?;
    let id = id.strip_suffix(".json")?;
    if revision.len() != 20 || !revision.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Uuid::parse_str(id).ok()?;
    revision.parse().ok()
}

fn is_token_directory(name: &str) -> bool {
    name.strip_prefix("token-")
        .and_then(|value| Uuid::parse_str(value).ok())
        .is_some()
}

fn is_staged_filename(name: &str) -> bool {
    name.strip_prefix("staged-state-")
        .and_then(|value| value.strip_suffix(".json"))
        .and_then(|value| Uuid::parse_str(value).ok())
        .is_some()
}

fn is_staged_mutex_filename(name: &str) -> bool {
    name.strip_prefix("staged-mutex-")
        .and_then(|value| value.strip_suffix(".json"))
        .and_then(|value| Uuid::parse_str(value).ok())
        .is_some()
}

fn modified_ms(metadata: &fs::Metadata) -> LockResult<i128> {
    metadata
        .modified()
        .map_err(|error| LockError::io("read modified time", error))?
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i128)
        .map_err(|error| LockError::new("CLOCK_FAILURE", error.to_string()))
}

#[cfg(unix)]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> Option<bool> {
    Some(left.dev() == right.dev() && left.ino() == right.ino())
}

#[cfg(not(unix))]
fn same_file_identity(_left: &fs::Metadata, _right: &fs::Metadata) -> Option<bool> {
    None
}

fn system_time_ms() -> LockResult<i128> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i128)
        .map_err(|error| LockError::new("CLOCK_FAILURE", error.to_string()))
}

fn format_timestamp(milliseconds: i128) -> LockResult<String> {
    let seconds = milliseconds.div_euclid(1_000);
    let remainder_ms = milliseconds.rem_euclid(1_000);
    let seconds = i64::try_from(seconds)
        .map_err(|error| LockError::new("CLOCK_FAILURE", error.to_string()))?;
    let value = OffsetDateTime::from_unix_timestamp(seconds)
        .map_err(|error| LockError::new("CLOCK_FAILURE", error.to_string()))?
        + TimeDuration::milliseconds(remainder_ms as i64);
    value
        .format(TIMESTAMP_FORMAT)
        .map_err(|error| LockError::new("CLOCK_FAILURE", error.to_string()))
}

fn parse_timestamp(value: &str) -> LockResult<i128> {
    let parsed = PrimitiveDateTime::parse(value, TIMESTAMP_FORMAT)
        .map_err(|error| LockError::new("STATE_CORRUPTION", error.to_string()))?
        .assume_utc();
    Ok(parsed.unix_timestamp_nanos() / 1_000_000)
}

fn valid_timestamp(value: &str) -> bool {
    parse_timestamp(value).is_ok()
}

fn expired(value: &str, now_ms: i128) -> LockResult<bool> {
    Ok(now_ms >= parse_timestamp(value)?)
}

// Dependency-free SHA-256 keeps coordination paths deterministic without touching app data.
fn sha256_hex(input: &[u8]) -> String {
    const INITIAL: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let bit_len = (input.len() as u64) * 8;
    let mut bytes = input.to_vec();
    bytes.push(0x80);
    while bytes.len() % 64 != 56 {
        bytes.push(0);
    }
    bytes.extend_from_slice(&bit_len.to_be_bytes());
    let mut state = INITIAL;
    for chunk in bytes.chunks_exact(64) {
        let mut words = [0_u32; 64];
        for (index, word) in words.iter_mut().take(16).enumerate() {
            *word = u32::from_be_bytes(chunk[index * 4..index * 4 + 4].try_into().unwrap());
        }
        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(s0)
                .wrapping_add(words[index - 7])
                .wrapping_add(s1);
        }
        let mut work = state;
        for index in 0..64 {
            let choice = (work[4] & work[5]) ^ (!work[4] & work[6]);
            let majority = (work[0] & work[1]) ^ (work[0] & work[2]) ^ (work[1] & work[2]);
            let sum0 =
                work[0].rotate_right(2) ^ work[0].rotate_right(13) ^ work[0].rotate_right(22);
            let sum1 =
                work[4].rotate_right(6) ^ work[4].rotate_right(11) ^ work[4].rotate_right(25);
            let temp1 = work[7]
                .wrapping_add(sum1)
                .wrapping_add(choice)
                .wrapping_add(K[index])
                .wrapping_add(words[index]);
            let temp2 = sum0.wrapping_add(majority);
            work = [
                temp1.wrapping_add(temp2),
                work[0],
                work[1],
                work[2],
                work[3].wrapping_add(temp1),
                work[4],
                work[5],
                work[6],
            ];
        }
        for (target, value) in state.iter_mut().zip(work) {
            *target = target.wrapping_add(value);
        }
    }
    state.iter().map(|value| format!("{value:08x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    use crate::database_operation_recovery_journal::{
        prepare_mutation_journal, ArtifactChecks, PreparedMutationJournal,
    };
    use tempfile::TempDir;

    const IDENTITY: &str = SHIKIN_DATABASE_IDENTITY;
    const LOCK_CONTRACT: &str = include_str!("../../schema/database-operation-lock-v1.json");
    const GOLDEN_FIXTURES: &str =
        include_str!("../../schema/database-operation-lock-v1-golden.json");

    fn lock(root: &TempDir, runtime: RuntimeId) -> DatabaseOperationLock {
        DatabaseOperationLock::new(
            fs::canonicalize(root.path()).unwrap().join("coordination"),
            IDENTITY.into(),
            runtime,
        )
        .unwrap()
    }

    fn error_code<T: fmt::Debug>(result: LockResult<T>) -> &'static str {
        result.unwrap_err().code
    }

    #[cfg(target_os = "linux")]
    fn prepare_proof(
        core: &mut DatabaseOperationLock,
        intent: &ExclusiveIntent,
    ) -> PreparedMutationJournal {
        let state = core.read_operation_state().unwrap();
        let binding = mutation_entry_binding(&state, intent, &core.paths.operation_root).unwrap();
        prepare_mutation_journal(&core.paths.operation_root, &binding, |context| {
            fs::write(context.path(), b"rust-lock-test-journal").unwrap();
            Ok(ArtifactChecks::all_ok())
        })
        .unwrap()
    }

    fn highest_state_path(core: &DatabaseOperationLock) -> PathBuf {
        let mut paths: Vec<PathBuf> = fs::read_dir(&core.paths.state_records)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        paths.sort();
        paths.pop().unwrap()
    }

    fn terminated_child_process_id() -> u32 {
        #[cfg(windows)]
        let mut child = Command::new("cmd")
            .args(["/C", "exit", "0"])
            .spawn()
            .unwrap();
        #[cfg(not(windows))]
        let mut child = Command::new("sh").args(["-c", "exit 0"]).spawn().unwrap();
        let process_id = child.id();
        assert!(child.wait().unwrap().success());
        process_id
    }

    fn test_mutex_record(owner: OwnerEvidence, mutex_id: String) -> RegistrationMutex {
        let now = system_time_ms().unwrap();
        RegistrationMutex {
            protocol: PROTOCOL.into(),
            protocol_version: PROTOCOL_VERSION,
            record_kind: RegistrationMutexKind::RegistrationMutex,
            database_identity: IDENTITY.into(),
            mutex_id,
            owner,
            acquired_at: format_timestamp(now).unwrap(),
            expires_at: format_timestamp(now + i128::from(DEFAULT_MUTEX_TTL_MS)).unwrap(),
            ttl_ms: DEFAULT_MUTEX_TTL_MS,
        }
    }

    fn publish_complete_mutex_directory(destination: &Path, record: &RegistrationMutex) {
        let parent = destination.parent().unwrap();
        let candidate = parent.join(format!(".test-mutex-candidate-{}", Uuid::new_v4()));
        fs::create_dir(&candidate).unwrap();
        set_private_dir_mode(&candidate).unwrap();
        let token = candidate.join(format!("token-{}", record.mutex_id));
        fs::create_dir(&token).unwrap();
        set_private_dir_mode(&token).unwrap();
        write_json_exclusive(&token.join("mutex.json"), record).unwrap();
        sync_directory(&candidate).unwrap();
        fs::rename(candidate, destination).unwrap();
    }

    fn cancelable_intent_fixture(
        root: &TempDir,
        phase: ExclusivePhase,
    ) -> (
        DatabaseOperationLock,
        DatabaseOperationLock,
        Option<RuntimeLease>,
        Option<RuntimeLease>,
        ExclusiveIntent,
    ) {
        let mut owner = lock(root, RuntimeId::Cli);
        let mut peer = lock(root, RuntimeId::Mcp);
        let mut owner_lease = Some(owner.register_runtime_lease().unwrap());
        let mut peer_lease = Some(peer.register_runtime_lease().unwrap());
        let mut intent = owner
            .acquire_exclusive_intent(DatabaseOperation::Restore, None)
            .unwrap();
        if phase != ExclusivePhase::Registered {
            intent = owner.drain_exclusive_intent(&intent).unwrap();
        }
        if phase == ExclusivePhase::Exclusive {
            peer.release_runtime_lease(peer_lease.as_ref().unwrap())
                .unwrap();
            peer_lease = None;
            owner
                .release_runtime_lease(owner_lease.as_ref().unwrap())
                .unwrap();
            owner_lease = None;
            intent = owner.drain_exclusive_intent(&intent).unwrap();
        }
        assert_eq!(intent.phase, phase);
        (owner, peer, owner_lease, peer_lease, intent)
    }

    fn publish_test_state(core: &DatabaseOperationLock, state: &OperationState) {
        let current_path = highest_state_path(core);
        let current: OperationState = read_json(&current_path, "operation state").unwrap();
        if current.state_revision == state.state_revision {
            fs::remove_file(current_path).unwrap();
        }
        let destination = core.paths.state_records.join(format!(
            "operation-state-{:020}-{}.json",
            state.state_revision,
            Uuid::new_v4()
        ));
        write_json_exclusive(&destination, state).unwrap();
    }

    #[test]
    fn contract_identity_and_record_defs_remain_version_one() {
        let contract: JsonValue = serde_json::from_str(LOCK_CONTRACT).unwrap();
        assert_eq!(
            contract["x-shikin-protocol"],
            JsonValue::String(PROTOCOL.into())
        );
        assert_eq!(contract["x-shikin-version"], JsonValue::from(1));
        for definition in [
            "operationStateRecord",
            "registrationMutexRecord",
            "runtimeLease",
            "exclusiveIntent",
        ] {
            assert!(contract["$defs"].get(definition).is_some());
        }
        assert_eq!(
            contract["x-shikin-timing-constraints"]["registrationMutexTtlMs"]["minimum"],
            JsonValue::from(MUTEX_MIN_TTL_MS)
        );
        assert_eq!(
            contract["x-shikin-timing-constraints"]["runtimeLeaseTtlMs"]["minimum"],
            JsonValue::from(LEASE_MIN_TTL_MS)
        );
    }

    #[test]
    fn golden_node_compatible_state_is_strictly_round_trippable() {
        let fixture = serde_json::json!({
            "protocol": PROTOCOL,
            "protocolVersion": 1,
            "recordKind": "operation_state",
            "databaseIdentity": IDENTITY,
            "stateRevision": 1,
            "fencingGenerationHighWater": 1,
            "leases": [{
                "recordKind": "runtime_lease",
                "leaseId": "lease-node-fixture",
                "owner": {
                    "ownerId": "owner-node-fixture",
                    "runtimeId": "cli",
                    "hostId": "host-node-fixture",
                    "processId": 1234,
                    "processStartedAt": "2026-07-14T12:00:00.000Z"
                },
                "fencingGeneration": 1,
                "acquiredAt": "2026-07-14T12:00:00.000Z",
                "heartbeatAt": "2026-07-14T12:00:01.000Z",
                "expiresAt": "2026-07-14T12:00:31.000Z",
                "ttlMs": 30000
            }],
            "exclusiveIntent": null,
            "updatedBy": {
                "ownerId": "owner-node-fixture",
                "runtimeId": "cli",
                "hostId": "host-node-fixture",
                "processId": 1234,
                "processStartedAt": "2026-07-14T12:00:00.000Z"
            },
            "updatedAt": "2026-07-14T12:00:01.000Z"
        });
        let state: OperationState =
            parse_protocol_value(fixture.clone(), "operation state").unwrap();
        validate_state(&state, IDENTITY).unwrap();
        assert_eq!(serde_json::to_value(state).unwrap(), fixture);
        let mut malformed = fixture;
        malformed["unknown"] = JsonValue::Bool(true);
        assert!(parse_protocol_value::<OperationState>(malformed, "operation state").is_err());
    }

    #[test]
    fn shared_node_rust_negative_golden_fixtures_match_exact_json_semantics() {
        let fixtures: JsonValue = serde_json::from_str(GOLDEN_FIXTURES).unwrap();
        for fixture in fixtures["cases"].as_array().unwrap() {
            let name = fixture["name"].as_str().unwrap();
            let record = fixture["record"].clone();
            let result = match record["recordKind"].as_str() {
                Some("operation_state") => {
                    parse_protocol_value::<OperationState>(record, "operation state")
                        .and_then(|state| validate_state(&state, IDENTITY))
                }
                Some("registration_mutex") => {
                    parse_protocol_value::<RegistrationMutex>(record, "registration mutex")
                        .and_then(|mutex| validate_mutex(&mutex, IDENTITY))
                }
                _ => panic!("unknown golden record kind for {name}"),
            };
            assert_eq!(
                result.is_ok(),
                fixture["valid"].as_bool().unwrap(),
                "{name}"
            );
        }
    }

    #[test]
    fn registration_renewal_release_and_exact_revisions() {
        let empty_root = TempDir::new().unwrap();
        let mut empty = lock(&empty_root, RuntimeId::Tauri);
        assert_eq!(empty.cleanup_stale_records().unwrap().state_revision, 0);

        let root = TempDir::new().unwrap();
        let mut core = lock(&root, RuntimeId::Cli);
        assert!(!core.paths().root.exists());
        let mut lease = core.register_runtime_lease().unwrap();
        assert_eq!(core.read_operation_state().unwrap().state_revision, 1);
        lease = core.renew_runtime_lease(&lease).unwrap();
        assert_eq!(core.read_operation_state().unwrap().state_revision, 2);
        assert!(core.lifecycle_health().healthy);
        assert!(core.release_runtime_lease(&lease).unwrap());
        let state = core.read_operation_state().unwrap();
        assert_eq!(state.state_revision, 3);
        assert_eq!(state.fencing_generation_high_water, 1);
        assert!(state.leases.is_empty());
    }

    #[test]
    fn forged_or_released_authority_cannot_change_a_successor() {
        let root = TempDir::new().unwrap();
        let mut original = lock(&root, RuntimeId::Cli);
        let lease = original.register_runtime_lease().unwrap();
        let mut forged = lease.clone();
        forged.fencing_generation += 1;
        assert_eq!(
            error_code(original.renew_runtime_lease(&forged)),
            "LEASE_FENCED"
        );
        assert_eq!(original.read_operation_state().unwrap().state_revision, 1);
        original.release_runtime_lease(&lease).unwrap();

        let mut successor = lock(&root, RuntimeId::Mcp);
        let successor_lease = successor.register_runtime_lease().unwrap();
        assert_eq!(
            error_code(original.release_runtime_lease(&lease)),
            "LEASE_FENCED"
        );
        assert_eq!(
            successor
                .assert_runtime_authority(&successor_lease)
                .unwrap(),
            successor_lease
        );
        assert_eq!(successor.read_operation_state().unwrap().state_revision, 3);
    }

    #[test]
    fn exclusive_acquisition_requires_exact_own_lease_without_rejecting_peers() {
        let root = TempDir::new().unwrap();
        let mut owner = lock(&root, RuntimeId::Cli);
        let mut peer = lock(&root, RuntimeId::BrowserDataServer);
        let mut no_lease = lock(&root, RuntimeId::Tauri);
        let before = no_lease.read_operation_state().unwrap();
        assert_eq!(
            error_code(no_lease.acquire_exclusive_intent(DatabaseOperation::Import, None)),
            "LEASE_REQUIRED"
        );
        let after = no_lease.read_operation_state().unwrap();
        assert_eq!(after.state_revision, before.state_revision);
        assert_eq!(
            after.fencing_generation_high_water,
            before.fencing_generation_high_water
        );

        let owner_lease = owner.register_runtime_lease().unwrap();
        let mut peer_lease = peer.register_runtime_lease().unwrap();
        let mut intent = owner
            .acquire_exclusive_intent(DatabaseOperation::Import, None)
            .unwrap();
        assert_eq!(intent.phase, ExclusivePhase::Registered);
        let state = owner.read_operation_state().unwrap();
        assert_eq!(state.leases.len(), 2);
        assert_eq!(state.state_revision, 3);
        assert_eq!(state.fencing_generation_high_water, 3);
        assert!(owner.lifecycle_health().should_drain);
        assert!(peer.lifecycle_health().should_drain);
        peer_lease = peer.renew_runtime_lease(&peer_lease).unwrap();
        intent = owner.drain_exclusive_intent(&intent).unwrap();
        assert_eq!(intent.phase, ExclusivePhase::Draining);
        peer.release_runtime_lease(&peer_lease).unwrap();
        assert_eq!(
            owner.drain_exclusive_intent(&intent).unwrap().phase,
            ExclusivePhase::Draining
        );
        owner.release_runtime_lease(&owner_lease).unwrap();
        assert_eq!(
            owner.drain_exclusive_intent(&intent).unwrap().phase,
            ExclusivePhase::Exclusive
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn intent_blocks_registration_and_runs_all_phases() {
        let root = TempDir::new().unwrap();
        let mut owner = lock(&root, RuntimeId::Cli);
        let mut other = lock(&root, RuntimeId::Mcp);
        let lease = owner.register_runtime_lease().unwrap();
        let mut caller_metadata = JsonMap::new();
        caller_metadata.insert("fixture".into(), JsonValue::Bool(true));
        let mut intent = owner
            .acquire_exclusive_intent(DatabaseOperation::Restore, Some(caller_metadata))
            .unwrap();
        assert_eq!(
            error_code(other.register_runtime_lease()),
            "EXCLUSIVE_INTENT_ACTIVE"
        );
        assert_eq!(owner.read_operation_state().unwrap().state_revision, 2);
        intent = owner.drain_exclusive_intent(&intent).unwrap();
        assert_eq!(intent.phase, ExclusivePhase::Draining);
        owner.release_runtime_lease(&lease).unwrap();
        intent = owner.drain_exclusive_intent(&intent).unwrap();
        assert_eq!(intent.phase, ExclusivePhase::Exclusive);
        let commitment_revision = owner.read_operation_state().unwrap().state_revision;
        let prepared = prepare_proof(&mut owner, &intent);
        intent = owner
            .begin_exclusive_mutation(&intent, prepared.proof())
            .unwrap();
        assert_eq!(intent.phase, ExclusivePhase::Mutating);
        let metadata = intent.metadata.as_ref().unwrap();
        assert_eq!(metadata.len(), 6);
        assert_eq!(metadata["fixture"], JsonValue::Bool(true));
        assert_eq!(
            metadata["recovery.protocol"],
            JsonValue::String(RECOVERY_JOURNAL_PROTOCOL.into())
        );
        assert_eq!(
            metadata["recovery.operationId"],
            JsonValue::String(intent.operation_id.clone())
        );
        assert_eq!(
            metadata["recovery.stateRevision"],
            JsonValue::from(commitment_revision)
        );
        assert_eq!(
            metadata["recovery.fencingGeneration"],
            JsonValue::from(intent.fencing_generation)
        );
        assert_eq!(
            metadata["recovery.commitmentSha256"],
            JsonValue::String(prepared.commitment_sha256().into())
        );
        let committed_metadata = intent.metadata.clone();
        assert_eq!(
            owner
                .assert_exclusive_authority(&intent, ExclusivePhase::Mutating)
                .unwrap(),
            intent
        );
        intent = owner.complete_exclusive_mutation(&intent).unwrap();
        assert_eq!(intent.phase, ExclusivePhase::Completed);
        assert_eq!(intent.metadata, committed_metadata);
        owner.clear_exclusive_intent(&intent).unwrap();
        let state = owner.read_operation_state().unwrap();
        assert_eq!(state.state_revision, 8);
        assert_eq!(state.fencing_generation_high_water, 2);
    }

    #[test]
    fn acquisition_rejects_reserved_and_noncanonical_caller_metadata_without_publication() {
        let root = TempDir::new().unwrap();
        let mut owner = lock(&root, RuntimeId::Cli);
        owner.register_runtime_lease().unwrap();
        let before = owner.read_operation_state().unwrap();
        for key in ["recovery.protocol", "recovery.future"] {
            let mut metadata = JsonMap::new();
            metadata.insert(key.into(), JsonValue::Bool(true));
            assert_eq!(
                error_code(
                    owner.acquire_exclusive_intent(DatabaseOperation::Restore, Some(metadata))
                ),
                "RESERVED_METADATA_KEY"
            );
            assert_eq!(owner.read_operation_state().unwrap(), before);
        }
        for value in [
            JsonValue::from(1.5),
            JsonValue::from(MAX_JSON_SAFE_INTEGER + 1),
        ] {
            let mut metadata = JsonMap::new();
            metadata.insert("value".into(), value);
            assert_eq!(
                error_code(
                    owner.acquire_exclusive_intent(DatabaseOperation::Restore, Some(metadata))
                ),
                "INVALID_OPTIONS"
            );
            assert_eq!(owner.read_operation_state().unwrap(), before);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn recovery_commitment_validation_binds_all_fields_and_keeps_legacy_records_valid() {
        let root = TempDir::new().unwrap();
        let (mut owner, _, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Exclusive);
        let prepared = prepare_proof(&mut owner, &intent);
        owner
            .begin_exclusive_mutation(&intent, prepared.proof())
            .unwrap();
        let state = owner.read_operation_state().unwrap();
        validate_state(&state, IDENTITY).unwrap();

        let mut legacy = state.clone();
        legacy.exclusive_intent.as_mut().unwrap().metadata = Some(JsonMap::from_iter([(
            "legacy".into(),
            JsonValue::Bool(true),
        )]));
        validate_state(&legacy, IDENTITY).unwrap();

        for key in [
            "recovery.operationId",
            "recovery.stateRevision",
            "recovery.fencingGeneration",
        ] {
            let mut malformed = state.clone();
            let intent = malformed.exclusive_intent.as_mut().unwrap();
            match key {
                "recovery.operationId" => {
                    intent
                        .metadata
                        .as_mut()
                        .unwrap()
                        .insert(key.into(), JsonValue::String("wrong-operation".into()));
                }
                _ => {
                    let current = intent.metadata.as_ref().unwrap()[key].as_u64().unwrap();
                    intent
                        .metadata
                        .as_mut()
                        .unwrap()
                        .insert(key.into(), JsonValue::from(current + 1));
                }
            }
            assert_eq!(
                error_code(validate_state(&malformed, IDENTITY)),
                "STATE_CORRUPTION",
                "{key}"
            );
        }
    }

    #[test]
    fn cancellation_allows_pre_mutation_phases_with_stale_evidence_and_exact_lease_preservation() {
        for phase in [
            ExclusivePhase::Registered,
            ExclusivePhase::Draining,
            ExclusivePhase::Exclusive,
        ] {
            let root = TempDir::new().unwrap();
            let (mut owner, mut peer, owner_lease, peer_lease, intent) =
                cancelable_intent_fixture(&root, phase);
            let before = owner.read_operation_state().unwrap();
            let lease_bytes = serde_json::to_vec(&before.leases).unwrap();
            let mut evidence = intent.clone();
            evidence.phase = if phase == ExclusivePhase::Registered {
                ExclusivePhase::Exclusive
            } else {
                ExclusivePhase::Registered
            };
            evidence.operation = DatabaseOperation::Import;

            assert!(owner.cancel_exclusive_intent(&evidence).unwrap());
            let after = owner.read_operation_state().unwrap();
            assert_eq!(after.state_revision, before.state_revision + 1);
            assert_eq!(
                after.fencing_generation_high_water,
                before.fencing_generation_high_water + 1
            );
            assert!(after.exclusive_intent.is_none());
            assert_eq!(serde_json::to_vec(&after.leases).unwrap(), lease_bytes);
            if let Some(lease) = owner_lease {
                assert_eq!(owner.assert_runtime_authority(&lease).unwrap(), lease);
            }
            if let Some(lease) = peer_lease {
                assert_eq!(peer.assert_runtime_authority(&lease).unwrap(), lease);
            }
            assert_eq!(
                error_code(owner.assert_exclusive_authority(&intent, phase)),
                "INTENT_FENCED"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn cancellation_uses_authority_before_persisted_forbidden_phase_precedence() {
        for phase in [
            ExclusivePhase::Mutating,
            ExclusivePhase::Completed,
            ExclusivePhase::Abandoned,
        ] {
            let root = TempDir::new().unwrap();
            let (mut owner, _, _, _, intent) =
                cancelable_intent_fixture(&root, ExclusivePhase::Exclusive);
            if matches!(phase, ExclusivePhase::Mutating | ExclusivePhase::Completed) {
                let prepared = prepare_proof(&mut owner, &intent);
                let mutating = owner
                    .begin_exclusive_mutation(&intent, prepared.proof())
                    .unwrap();
                if phase == ExclusivePhase::Completed {
                    owner.complete_exclusive_mutation(&mutating).unwrap();
                }
            } else {
                let mut state = owner.read_operation_state().unwrap();
                state.exclusive_intent.as_mut().unwrap().phase = ExclusivePhase::Abandoned;
                publish_test_state(&owner, &state);
            }
            let before = owner.read_operation_state().unwrap();
            let mut stale_phase_evidence = intent.clone();
            stale_phase_evidence.phase = ExclusivePhase::Registered;
            let mut wrong_authority = stale_phase_evidence.clone();
            wrong_authority.operation_id = format!("wrong-{}", intent.operation_id);

            assert_eq!(
                error_code(owner.cancel_exclusive_intent(&wrong_authority)),
                "INTENT_FENCED"
            );
            assert_eq!(owner.read_operation_state().unwrap(), before);
            assert_eq!(
                error_code(owner.cancel_exclusive_intent(&stale_phase_evidence)),
                "INTENT_PHASE_INVALID"
            );
            assert_eq!(owner.read_operation_state().unwrap(), before);
        }
    }

    #[test]
    fn cancellation_fences_absent_and_mismatched_evidence_without_self_fencing() {
        let root = TempDir::new().unwrap();
        let (mut owner, mut peer, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Registered);
        let before = owner.read_operation_state().unwrap();

        let mut wrong_operation = intent.clone();
        wrong_operation.operation_id = format!("wrong-{}", intent.operation_id);
        assert_eq!(
            error_code(owner.cancel_exclusive_intent(&wrong_operation)),
            "INTENT_FENCED"
        );
        let mut wrong_generation = intent.clone();
        wrong_generation.fencing_generation += 1;
        assert_eq!(
            error_code(owner.cancel_exclusive_intent(&wrong_generation)),
            "INTENT_FENCED"
        );
        assert_eq!(owner.read_operation_state().unwrap(), before);

        let peer_owner = peer.owner_evidence().unwrap();
        let mut caller_mismatch = intent.clone();
        caller_mismatch.owner = peer_owner;
        assert_eq!(
            error_code(owner.cancel_exclusive_intent(&caller_mismatch)),
            "INTENT_FENCED"
        );
        assert!(!owner.fenced);
        assert_eq!(owner.read_operation_state().unwrap(), before);
        assert_eq!(
            error_code(peer.cancel_exclusive_intent(&caller_mismatch)),
            "INTENT_FENCED"
        );
        assert!(!peer.fenced);
        assert_eq!(owner.read_operation_state().unwrap(), before);

        let mut malformed = intent.clone();
        malformed.operation_id.clear();
        assert_eq!(
            error_code(owner.cancel_exclusive_intent(&malformed)),
            "INVALID_OPTIONS"
        );
        assert_eq!(owner.read_operation_state().unwrap(), before);

        assert!(owner.cancel_exclusive_intent(&intent).unwrap());
        let cancelled = owner.read_operation_state().unwrap();
        assert_eq!(
            error_code(owner.cancel_exclusive_intent(&intent)),
            "INTENT_FENCED"
        );
        assert_eq!(owner.read_operation_state().unwrap(), cancelled);
    }

    #[test]
    fn cancellation_guards_revision_and_high_water_overflow_independently() {
        for revision_overflow in [true, false] {
            let root = TempDir::new().unwrap();
            let (mut owner, _, _, _, intent) =
                cancelable_intent_fixture(&root, ExclusivePhase::Registered);
            let mut state = owner.read_operation_state().unwrap();
            if revision_overflow {
                state.state_revision = MAX_JSON_SAFE_INTEGER;
            } else {
                state.fencing_generation_high_water = MAX_JSON_SAFE_INTEGER;
            }
            publish_test_state(&owner, &state);
            let before = owner.read_operation_state().unwrap();

            assert_eq!(
                error_code(owner.cancel_exclusive_intent(&intent)),
                "COUNTER_OVERFLOW"
            );
            assert_eq!(owner.read_operation_state().unwrap(), before);
        }
    }

    #[test]
    fn cancellation_preserves_prepublication_and_committed_durability_classification() {
        let root = TempDir::new().unwrap();
        let (mut before_publish, _, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Registered);
        let before = before_publish.read_operation_state().unwrap();
        before_publish.fault_point = Some("after_prune");
        assert_eq!(
            error_code(before_publish.cancel_exclusive_intent(&intent)),
            "INJECTED_FAILURE"
        );
        assert_eq!(before_publish.read_operation_state().unwrap(), before);
        assert!(!before_publish.fenced);
        assert_eq!(
            before_publish.last_committed_state_revision,
            Some(before.state_revision)
        );

        let root = TempDir::new().unwrap();
        let (mut after_rename, _, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Registered);
        let before = after_rename.read_operation_state().unwrap();
        after_rename.fault_point = Some("after_rename");
        assert!(after_rename.cancel_exclusive_intent(&intent).unwrap());
        let after = after_rename.read_operation_state().unwrap();
        assert_eq!(after.state_revision, before.state_revision + 1);
        assert_eq!(
            after.fencing_generation_high_water,
            before.fencing_generation_high_water + 1
        );
        assert!(after.exclusive_intent.is_none());
        let health = after_rename.lifecycle_health();
        assert!(health.fenced);
        assert!(health.durability_uncertain);
        assert_eq!(
            health.last_committed_state_revision,
            Some(after.state_revision)
        );

        let root = TempDir::new().unwrap();
        let (mut unsupported, _, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Registered);
        let before = unsupported.read_operation_state().unwrap();
        unsupported.fault_point = Some("directory_sync_unsupported");
        assert!(unsupported.cancel_exclusive_intent(&intent).unwrap());
        let after = unsupported.read_operation_state().unwrap();
        assert_eq!(after.state_revision, before.state_revision + 1);
        assert!(after.exclusive_intent.is_none());
        let health = unsupported.lifecycle_health();
        assert!(!health.fenced);
        assert!(health.registered);
        assert!(!health.should_drain);
        assert!(health.maintenance_degraded);
        assert!(!health.durability_uncertain);
        assert_eq!(
            health.last_committed_state_revision,
            Some(after.state_revision)
        );

        for point in ["after_fsync", "after_release"] {
            let root = TempDir::new().unwrap();
            let (mut committed, _, _, _, intent) =
                cancelable_intent_fixture(&root, ExclusivePhase::Registered);
            let before = committed.read_operation_state().unwrap();
            committed.fault_point = Some(point);
            assert!(committed.cancel_exclusive_intent(&intent).unwrap());
            let after = committed.read_operation_state().unwrap();
            assert_eq!(after.state_revision, before.state_revision + 1);
            assert!(after.exclusive_intent.is_none());
            let health = committed.lifecycle_health();
            assert!(!health.fenced);
            assert!(health.registered);
            assert!(!health.should_drain);
            assert!(health.maintenance_degraded);
            assert!(!health.durability_uncertain);
            assert_eq!(
                health.last_committed_state_revision,
                Some(after.state_revision)
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn cancellation_orders_cancel_then_begin_and_begin_then_cancel() {
        let root = TempDir::new().unwrap();
        let (mut cancel_first, _, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Exclusive);
        let cancelled_proof = prepare_proof(&mut cancel_first, &intent);
        assert!(cancel_first.cancel_exclusive_intent(&intent).unwrap());
        assert_eq!(
            error_code(cancel_first.begin_exclusive_mutation(&intent, cancelled_proof.proof())),
            "INTENT_FENCED"
        );

        let root = TempDir::new().unwrap();
        let (mut begin_first, _, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Exclusive);
        let prepared = prepare_proof(&mut begin_first, &intent);
        let mutating = begin_first
            .begin_exclusive_mutation(&intent, prepared.proof())
            .unwrap();
        let before = begin_first.read_operation_state().unwrap();
        assert_eq!(
            error_code(begin_first.cancel_exclusive_intent(&mutating)),
            "INTENT_PHASE_INVALID"
        );
        assert_eq!(begin_first.read_operation_state().unwrap(), before);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn begin_requires_an_authentic_current_proof_and_preserves_journal_error_cause() {
        let root = TempDir::new().unwrap();
        let (mut owner, _, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Exclusive);
        let prepared = prepare_proof(&mut owner, &intent);
        let mut successor = owner.read_operation_state().unwrap();
        successor.state_revision += 1;
        publish_test_state(&owner, &successor);
        let before = owner.read_operation_state().unwrap();
        let error = owner
            .begin_exclusive_mutation(&intent, prepared.proof())
            .unwrap_err();
        assert_eq!(error.code, "PREPARED_PROOF_INVALID");
        assert!(error
            .source()
            .and_then(|source| source.downcast_ref::<RecoveryJournalError>())
            .is_some());
        assert_eq!(owner.read_operation_state().unwrap(), before);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn strict_mutation_publication_reuses_precommit_proof_and_consumes_every_commit() {
        let root = TempDir::new().unwrap();
        let (mut reusable, _, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Exclusive);
        let prepared = prepare_proof(&mut reusable, &intent);
        let before = reusable.read_operation_state().unwrap();
        reusable.fault_point = Some("after_prune");
        assert_eq!(
            error_code(reusable.begin_exclusive_mutation(&intent, prepared.proof())),
            "INJECTED_FAILURE"
        );
        assert_eq!(reusable.read_operation_state().unwrap(), before);
        reusable.fault_point = None;
        assert_eq!(
            reusable
                .begin_exclusive_mutation(&intent, prepared.proof())
                .unwrap()
                .phase,
            ExclusivePhase::Mutating
        );

        for point in [
            "after_rename",
            "directory_sync_unsupported",
            "directory_sync_failure",
        ] {
            let root = TempDir::new().unwrap();
            let (mut committed, _, _, _, intent) =
                cancelable_intent_fixture(&root, ExclusivePhase::Exclusive);
            let prepared = prepare_proof(&mut committed, &intent);
            let binding = mutation_entry_binding(
                &committed.read_operation_state().unwrap(),
                &intent,
                &committed.paths.operation_root,
            )
            .unwrap();
            committed.fault_point = Some(point);
            let error = committed
                .begin_exclusive_mutation(&intent, prepared.proof())
                .unwrap_err();
            assert_eq!(
                error.code, "MUTATION_COMMIT_DURABILITY_UNCERTAIN",
                "{point}"
            );
            assert!(error.source().is_some(), "{point}");
            assert_eq!(
                committed
                    .read_operation_state()
                    .unwrap()
                    .exclusive_intent
                    .unwrap()
                    .phase,
                ExclusivePhase::Mutating,
                "{point}"
            );
            assert!(committed.lifecycle_health().fenced, "{point}");
            assert_eq!(
                verify_prepared_mutation_proof(
                    prepared.proof(),
                    &committed.paths.operation_root,
                    &binding,
                )
                .unwrap_err()
                .code(),
                "PREPARED_PROOF_USED",
                "{point}"
            );
        }

        let root = TempDir::new().unwrap();
        let (mut durable, _, _, _, intent) =
            cancelable_intent_fixture(&root, ExclusivePhase::Exclusive);
        let prepared = prepare_proof(&mut durable, &intent);
        durable.fault_point = Some("after_fsync");
        assert_eq!(
            durable
                .begin_exclusive_mutation(&intent, prepared.proof())
                .unwrap()
                .phase,
            ExclusivePhase::Mutating
        );
        let health = durable.lifecycle_health();
        assert!(!health.fenced);
        assert!(health.maintenance_degraded);
        assert!(!health.durability_uncertain);
    }

    #[test]
    fn panicking_infallible_commit_callback_is_committed_and_internal_fatal() {
        let root = TempDir::new().unwrap();
        let mut core = lock(&root, RuntimeId::Cli);
        core.register_runtime_lease().unwrap();
        let before = core.read_operation_state().unwrap();
        let result = core.mutate_state_with_options(
            |previous, _| Ok(Mutation::Change(Box::new(previous), ())),
            StatePublicationOptions {
                before_final_fence: |_| Ok(()),
                on_committed: |_| panic!("infallible callback violated"),
                durability_policy: DurabilityPolicy::RequiredForMutationAuthority,
            },
        );
        assert_eq!(error_code(result), "MUTATION_COMMIT_DURABILITY_UNCERTAIN");
        assert_eq!(
            core.read_operation_state().unwrap().state_revision,
            before.state_revision + 1
        );
        assert!(core.lifecycle_health().fenced);
    }

    #[test]
    fn live_expired_owner_blocks_but_dead_expired_owner_is_reclaimed() {
        let root = TempDir::new().unwrap();
        let timing = Timing {
            lease_ttl_ms: 5_000,
            heartbeat_interval_ms: 1_000,
            ..Timing::default()
        };
        let mut live = lock(&root, RuntimeId::Cli)
            .with_timing(timing)
            .unwrap()
            .with_clock_offset(-10_000);
        let lease = live.register_runtime_lease().unwrap();
        let mut cleaner = lock(&root, RuntimeId::Tauri);
        assert!(cleaner
            .cleanup_stale_records()
            .unwrap()
            .removed_lease_ids
            .is_empty());
        assert!(live.release_runtime_lease(&lease).unwrap());

        let mut state = cleaner.read_operation_state().unwrap();
        let dead_owner = OwnerEvidence {
            owner_id: "dead-owner".into(),
            runtime_id: RuntimeId::Mcp,
            host_id: cleaner.owner_evidence().unwrap().host_id,
            process_id: terminated_child_process_id(),
            process_started_at: "2026-07-14T12:00:00.000Z".into(),
        };
        state.state_revision += 1;
        state.fencing_generation_high_water += 1;
        state.leases.push(RuntimeLease {
            record_kind: RuntimeLeaseKind::RuntimeLease,
            lease_id: "dead-lease".into(),
            owner: dead_owner,
            fencing_generation: state.fencing_generation_high_water,
            acquired_at: "2026-07-14T12:00:00.000Z".into(),
            heartbeat_at: "2026-07-14T12:00:00.000Z".into(),
            expires_at: "2026-07-14T12:00:05.000Z".into(),
            ttl_ms: 5_000,
        });
        state.updated_at = format_timestamp(cleaner.now_ms().unwrap()).unwrap();
        let path = cleaner.paths.state_records.join(format!(
            "operation-state-{:020}-{}.json",
            state.state_revision,
            Uuid::new_v4()
        ));
        write_json_exclusive(&path, &state).unwrap();
        let cleanup = cleaner.cleanup_stale_records().unwrap();
        assert_eq!(cleanup.removed_lease_ids, vec!["dead-lease"]);
        assert_eq!(cleanup.state_revision, state.state_revision + 1);
    }

    #[test]
    fn interrupted_candidate_never_exposes_an_incomplete_fixed_mutex() {
        let root = TempDir::new().unwrap();
        let mut interrupted = lock(&root, RuntimeId::Cli).with_fault("before_mutex_publication");
        interrupted.owner_evidence().unwrap();
        assert_eq!(error_code(interrupted.acquire_mutex()), "INJECTED_FAILURE");
        assert!(!interrupted.paths.registration_mutex.exists());
        let candidates: Vec<PathBuf> = fs::read_dir(&interrupted.paths.operation_root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".candidate-mutex-")
            })
            .collect();
        assert_eq!(candidates.len(), 1);
        assert!(matches!(
            inspect_mutex(&candidates[0], IDENTITY, DEFAULT_MUTEX_TTL_MS).unwrap(),
            MutexInspection::Complete { .. }
        ));

        let mut successor = lock(&root, RuntimeId::Tauri);
        let guard = successor.acquire_mutex().unwrap();
        assert!(matches!(
            inspect_mutex(
                &successor.paths.registration_mutex,
                IDENTITY,
                DEFAULT_MUTEX_TTL_MS,
            )
            .unwrap(),
            MutexInspection::Complete { ref record, .. }
                if record.mutex_id == guard.record.mutex_id
        ));
        assert!(successor.release_mutex(&guard).unwrap());
    }

    #[test]
    fn quarantine_restore_collision_preserves_complete_successor() {
        let root = TempDir::new().unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let mut holder =
            lock(&root, RuntimeId::Cli).with_release_quarantine_barrier(Arc::clone(&barrier));
        let mut successor = lock(&root, RuntimeId::Tauri);
        holder.owner_evidence().unwrap();
        let successor_owner = successor.owner_evidence().unwrap();
        let old_guard = holder.acquire_mutex().unwrap();

        let release = thread::spawn(move || holder.release_mutex(&old_guard));
        barrier.wait();
        let quarantine = fs::read_dir(&successor.paths.operation_root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".quarantine-release-")
            })
            .unwrap();
        fs::remove_dir_all(&quarantine).unwrap();
        let moved_replacement =
            test_mutex_record(successor_owner.clone(), Uuid::new_v4().to_string());
        publish_complete_mutex_directory(&quarantine, &moved_replacement);
        let successor_guard = successor.acquire_mutex().unwrap();
        barrier.wait();

        assert_eq!(error_code(release.join().unwrap()), "MUTEX_FENCED");
        let inspection = inspect_mutex(
            &successor.paths.registration_mutex,
            IDENTITY,
            DEFAULT_MUTEX_TTL_MS,
        )
        .unwrap();
        assert!(matches!(
            inspection,
            MutexInspection::Complete { ref record, .. }
                if record.mutex_id == successor_guard.record.mutex_id
        ));
        let entries = read_entry_names(&successor.paths.registration_mutex).unwrap();
        assert_eq!(
            entries,
            vec![format!("token-{}", successor_guard.record.mutex_id)]
        );
        assert_eq!(
            read_entry_names(&successor.paths.registration_mutex.join(&entries[0])).unwrap(),
            vec!["mutex.json"]
        );
        assert!(successor.release_mutex(&successor_guard).unwrap());
    }

    #[test]
    fn delayed_superseded_mutex_cannot_publish_or_release_successor() {
        let root = TempDir::new().unwrap();
        let mut old = lock(&root, RuntimeId::Cli);
        let mut successor = lock(&root, RuntimeId::Tauri);
        old.ensure_owner().unwrap();
        successor.ensure_owner().unwrap();
        let old_guard = old.acquire_mutex().unwrap();
        let mut next = old.read_authoritative_state().unwrap();
        next.state_revision = 1;
        next.updated_by = old.owner_evidence().unwrap();
        next.updated_at = format_timestamp(old.now_ms().unwrap()).unwrap();
        let staged = old.stage_state(&old_guard, &next).unwrap();
        let quarantine = old
            .paths
            .operation_root
            .join(format!(".test-superseded-{}", Uuid::new_v4()));
        fs::rename(&old.paths.registration_mutex, &quarantine).unwrap();
        let successor_guard = successor.acquire_mutex().unwrap();

        assert_eq!(
            error_code(old.publish_staged_state(&old_guard, &staged, 1)),
            "MUTEX_FENCED"
        );
        assert!(!old.release_mutex(&old_guard).unwrap());
        assert!(old.paths.registration_mutex.exists());
        let inspection = inspect_mutex(
            &old.paths.registration_mutex,
            IDENTITY,
            DEFAULT_MUTEX_TTL_MS,
        )
        .unwrap();
        assert!(matches!(
            inspection,
            MutexInspection::Complete { record, .. }
                if record.mutex_id == successor_guard.record.mutex_id
        ));
        successor.release_mutex(&successor_guard).unwrap();
    }

    #[test]
    fn expired_complete_mutex_is_reclaimed_by_full_authority_evidence() {
        let root = TempDir::new().unwrap();
        let mut expired = lock(&root, RuntimeId::Cli).with_clock_offset(-10_000);
        expired.ensure_owner().unwrap();
        let expired_guard = expired.acquire_mutex().unwrap();
        let mut successor = lock(&root, RuntimeId::Tauri);
        successor.ensure_owner().unwrap();
        let successor_guard = successor.acquire_mutex().unwrap();
        assert_ne!(
            expired_guard.record.mutex_id,
            successor_guard.record.mutex_id
        );
        assert!(!expired.release_mutex(&expired_guard).unwrap());
        assert!(successor.release_mutex(&successor_guard).unwrap());
    }

    #[test]
    fn malformed_and_duplicate_highest_state_fail_closed() {
        let root = TempDir::new().unwrap();
        let mut core = lock(&root, RuntimeId::Cli);
        core.register_runtime_lease().unwrap();
        let state = core.read_operation_state().unwrap();
        let duplicate = core.paths.state_records.join(format!(
            "operation-state-{:020}-{}.json",
            state.state_revision,
            Uuid::new_v4()
        ));
        write_json_exclusive(&duplicate, &state).unwrap();
        assert_eq!(error_code(core.read_operation_state()), "STATE_CORRUPTION");
    }

    #[test]
    fn expired_and_forged_own_intent_admission_does_not_advance_state() {
        let root = TempDir::new().unwrap();
        let mut expired = lock(&root, RuntimeId::Cli).with_clock_offset(-40_000);
        expired.register_runtime_lease().unwrap();
        expired.clock_offset_ms = 0;
        let before = expired.read_operation_state().unwrap();
        assert_eq!(
            error_code(expired.acquire_exclusive_intent(DatabaseOperation::Restore, None)),
            "LEASE_EXPIRED"
        );
        let after = expired.read_operation_state().unwrap();
        assert_eq!(after.state_revision, before.state_revision);
        assert_eq!(
            after.fencing_generation_high_water,
            before.fencing_generation_high_water
        );

        let forged_root = TempDir::new().unwrap();
        let mut forged = lock(&forged_root, RuntimeId::Mcp);
        forged.register_runtime_lease().unwrap();
        let path = highest_state_path(&forged);
        let mut state = forged.read_operation_state().unwrap();
        state.leases[0].owner.process_started_at = "2000-01-01T00:00:00.000Z".into();
        fs::remove_file(&path).unwrap();
        write_json_exclusive(&path, &state).unwrap();
        let before = forged.read_operation_state().unwrap();
        assert_eq!(
            error_code(forged.acquire_exclusive_intent(DatabaseOperation::Restore, None)),
            "LEASE_FENCED"
        );
        let after = forged.read_operation_state().unwrap();
        assert_eq!(after.state_revision, before.state_revision);
        assert_eq!(
            after.fencing_generation_high_water,
            before.fencing_generation_high_water
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn stale_cleanup_removes_every_dead_non_mutating_phase_once_but_preserves_mutating() {
        for phase in [
            ExclusivePhase::Registered,
            ExclusivePhase::Draining,
            ExclusivePhase::Exclusive,
            ExclusivePhase::Completed,
            ExclusivePhase::Abandoned,
        ] {
            let root = TempDir::new().unwrap();
            let mut owner = lock(&root, RuntimeId::Cli);
            let lease = owner.register_runtime_lease().unwrap();
            let mut intent = owner
                .acquire_exclusive_intent(DatabaseOperation::Restore, None)
                .unwrap();
            if phase != ExclusivePhase::Registered {
                intent = owner.drain_exclusive_intent(&intent).unwrap();
            }
            owner.release_runtime_lease(&lease).unwrap();
            if matches!(
                phase,
                ExclusivePhase::Exclusive | ExclusivePhase::Completed | ExclusivePhase::Abandoned
            ) {
                intent = owner.drain_exclusive_intent(&intent).unwrap();
            }
            if phase == ExclusivePhase::Completed {
                let prepared = prepare_proof(&mut owner, &intent);
                intent = owner
                    .begin_exclusive_mutation(&intent, prepared.proof())
                    .unwrap();
                intent = owner.complete_exclusive_mutation(&intent).unwrap();
            }
            let path = highest_state_path(&owner);
            let mut state = owner.read_operation_state().unwrap();
            let stale = state.exclusive_intent.as_mut().unwrap();
            stale.phase = phase;
            stale.owner.process_id = terminated_child_process_id();
            stale.owner.process_started_at = "2000-01-01T00:00:00.000Z".into();
            fs::remove_file(&path).unwrap();
            write_json_exclusive(&path, &state).unwrap();

            let mut cleaner = lock(&root, RuntimeId::Tauri);
            let before = cleaner.read_operation_state().unwrap();
            let cleanup = cleaner.cleanup_stale_records().unwrap();
            assert!(cleanup.abandoned_intent);
            assert_eq!(cleanup.state_revision, before.state_revision + 1);
            let after = cleaner.read_operation_state().unwrap();
            assert!(after.exclusive_intent.is_none());
            assert_eq!(
                after.fencing_generation_high_water,
                before.fencing_generation_high_water + 1
            );
            let second = cleaner.cleanup_stale_records().unwrap();
            assert!(!second.abandoned_intent);
            assert_eq!(second.state_revision, after.state_revision);
            assert_eq!(
                error_code(owner.assert_exclusive_authority(&intent, phase)),
                "INTENT_FENCED"
            );
        }

        let root = TempDir::new().unwrap();
        let mut owner = lock(&root, RuntimeId::Cli);
        let lease = owner.register_runtime_lease().unwrap();
        let mut intent = owner
            .acquire_exclusive_intent(DatabaseOperation::Restore, None)
            .unwrap();
        intent = owner.drain_exclusive_intent(&intent).unwrap();
        owner.release_runtime_lease(&lease).unwrap();
        intent = owner.drain_exclusive_intent(&intent).unwrap();
        let prepared = prepare_proof(&mut owner, &intent);
        owner
            .begin_exclusive_mutation(&intent, prepared.proof())
            .unwrap();
        let path = highest_state_path(&owner);
        let mut state = owner.read_operation_state().unwrap();
        let stale = state.exclusive_intent.as_mut().unwrap();
        stale.owner.process_id = terminated_child_process_id();
        stale.owner.process_started_at = "2000-01-01T00:00:00.000Z".into();
        fs::remove_file(&path).unwrap();
        write_json_exclusive(&path, &state).unwrap();
        let mut cleaner = lock(&root, RuntimeId::Tauri);
        let before = cleaner.read_operation_state().unwrap();
        assert!(!cleaner.cleanup_stale_records().unwrap().abandoned_intent);
        assert_eq!(cleaner.read_operation_state().unwrap(), before);
    }

    #[test]
    fn directory_sync_error_classification_preserves_unsupported_and_failure_semantics() {
        for kind in [
            io::ErrorKind::InvalidInput,
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::Unsupported,
        ] {
            assert_eq!(
                classify_directory_sync_error(io::Error::from(kind)).unwrap(),
                DirectorySync::Unsupported
            );
        }

        assert_eq!(
            error_code(classify_directory_sync_error(io::Error::other(
                "genuine directory sync failure"
            ))),
            "FILESYSTEM_FAILURE"
        );
    }

    #[test]
    fn mutation_fault_points_distinguish_precommit_and_committed_results() {
        let root = TempDir::new().unwrap();
        let mut before = lock(&root, RuntimeId::Cli).with_fault("after_prune");
        assert_eq!(
            error_code(before.register_runtime_lease()),
            "INJECTED_FAILURE"
        );
        assert_eq!(before.read_operation_state().unwrap().state_revision, 0);
        assert!(before.current_lease.is_none());

        let root = TempDir::new().unwrap();
        let mut renamed = lock(&root, RuntimeId::Mcp).with_fault("after_rename");
        let lease = renamed.register_runtime_lease().unwrap();
        assert_eq!(renamed.read_operation_state().unwrap().state_revision, 1);
        assert_eq!(renamed.current_lease, Some(lease.clone()));
        let health = renamed.lifecycle_health();
        assert!(health.fenced);
        assert!(health.durability_uncertain);
        assert_eq!(health.last_committed_state_revision, Some(1));
        assert_eq!(
            error_code(renamed.renew_runtime_lease(&lease)),
            "OWNER_SELF_FENCED"
        );

        let root = TempDir::new().unwrap();
        let mut unsupported =
            lock(&root, RuntimeId::Tauri).with_fault("directory_sync_unsupported");
        let lease = unsupported.register_runtime_lease().unwrap();
        assert_eq!(unsupported.current_lease, Some(lease));
        let health = unsupported.lifecycle_health();
        assert!(!health.healthy);
        assert!(!health.fenced);
        assert!(health.registered);
        assert!(!health.should_drain);
        assert_eq!(
            health.reason.as_deref(),
            Some(
                "DIRECTORY_SYNC_UNSUPPORTED: State record is published but directory fsync is unsupported"
            )
        );
        assert_eq!(health.state_revision, Some(1));
        assert_eq!(
            health.fencing_generation,
            unsupported
                .current_lease
                .as_ref()
                .map(|item| item.fencing_generation)
        );
        assert!(health.maintenance_degraded);
        assert!(!health.durability_uncertain);
        assert_eq!(health.last_committed_state_revision, Some(1));

        for point in ["after_fsync", "after_release"] {
            let root = TempDir::new().unwrap();
            let mut degraded = lock(&root, RuntimeId::Tauri).with_fault(point);
            let lease = degraded.register_runtime_lease().unwrap();
            assert_eq!(degraded.current_lease, Some(lease));
            let health = degraded.lifecycle_health();
            assert!(!health.fenced);
            assert!(health.registered);
            assert!(health.maintenance_degraded);
            assert!(!health.durability_uncertain);
            assert_eq!(health.last_committed_state_revision, Some(1));
        }
    }

    #[test]
    fn churn_after_release_can_prune_the_old_record_without_losing_its_effect() {
        let root = TempDir::new().unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let mut first =
            lock(&root, RuntimeId::Cli).with_after_release_barrier(Arc::clone(&barrier));
        first.max_state_records = 2;
        let registration = thread::spawn(move || first.register_runtime_lease());

        barrier.wait();
        let mut churn = lock(&root, RuntimeId::Mcp);
        churn.max_state_records = 2;
        let churn_lease = churn.register_runtime_lease().unwrap();
        churn.release_runtime_lease(&churn_lease).unwrap();
        barrier.wait();

        let retained_lease = registration.join().unwrap().unwrap();
        let state = churn.read_operation_state().unwrap();
        assert_eq!(state.state_revision, 3);
        assert_eq!(state.leases, vec![retained_lease]);
        assert_eq!(fs::read_dir(&churn.paths.state_records).unwrap().count(), 2);
    }

    #[test]
    fn pruning_happens_before_publication_and_never_exceeds_capacity() {
        let root = TempDir::new().unwrap();
        let mut core = lock(&root, RuntimeId::Cli);
        core.max_state_records = 3;
        for _ in 0..12 {
            let lease = core.register_runtime_lease().unwrap();
            core.release_runtime_lease(&lease).unwrap();
            assert!(fs::read_dir(&core.paths.state_records).unwrap().count() <= 3);
        }
        assert_eq!(core.read_operation_state().unwrap().state_revision, 24);
        assert_eq!(fs::read_dir(&core.paths.state_records).unwrap().count(), 3);
    }

    #[test]
    fn state_reader_retries_when_an_enumerated_record_is_legitimately_pruned() {
        let root = TempDir::new().unwrap();
        let mut churn = lock(&root, RuntimeId::Cli);
        churn.max_state_records = 3;
        for _ in 0..4 {
            let lease = churn.register_runtime_lease().unwrap();
            churn.release_runtime_lease(&lease).unwrap();
        }
        let mut reader = lock(&root, RuntimeId::Tauri).with_read_turnover();
        let state = reader.read_operation_state().unwrap();
        assert_eq!(state.state_revision, 8);
        assert!(state.leases.is_empty());
        assert!(!reader.read_turnover_once);
    }

    #[test]
    fn fixed_database_identity_and_canonical_root_are_fail_closed_and_inert() {
        let root = TempDir::new().unwrap();
        let alias_path = root.path().join("alias-root");
        for alias in ["shikin.db", "/tmp/shikin.db", "COM.ASF.SHIKIN:SHIKIN.DB"] {
            assert_eq!(
                error_code(DatabaseOperationLock::new(
                    alias_path.clone(),
                    alias.into(),
                    RuntimeId::Cli,
                )),
                "INVALID_DATABASE_IDENTITY"
            );
        }
        assert!(!alias_path.exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let canonical = fs::canonicalize(root.path()).unwrap();
            let target = canonical.join("target");
            let alias = canonical.join("alias");
            fs::create_dir(&target).unwrap();
            symlink(&target, &alias).unwrap();
            let mut unsafe_lock =
                DatabaseOperationLock::new(alias, IDENTITY.into(), RuntimeId::Tauri).unwrap();
            assert_eq!(error_code(unsafe_lock.owner_evidence()), "UNSAFE_PATH");
            assert_eq!(fs::read_dir(target).unwrap().count(), 0);
        }
    }

    #[test]
    fn unpublished_host_stage_is_ignored_but_stable_malformed_identity_fails_closed() {
        let root = TempDir::new().unwrap();
        let mut initializer = lock(&root, RuntimeId::Cli);
        initializer.owner_evidence().unwrap();
        fs::remove_file(&initializer.paths.host_identity).unwrap();
        fs::write(
            initializer
                .paths
                .root
                .join(format!(".machine-host-identity-{}.json", Uuid::new_v4())),
            b"{partial",
        )
        .unwrap();
        let mut successor = lock(&root, RuntimeId::Tauri);
        assert!(!successor.owner_evidence().unwrap().host_id.is_empty());

        let malformed_root = TempDir::new().unwrap();
        let mut malformed = lock(&malformed_root, RuntimeId::Mcp);
        malformed.ensure_paths().unwrap();
        fs::write(&malformed.paths.host_identity, b"{partial").unwrap();
        #[cfg(unix)]
        fs::set_permissions(
            &malformed.paths.host_identity,
            fs::Permissions::from_mode(PRIVATE_FILE_MODE),
        )
        .unwrap();
        assert_eq!(error_code(malformed.owner_evidence()), "HOST_ID_CORRUPTION");
    }

    #[cfg(unix)]
    #[test]
    fn incomplete_unpublished_mutex_stage_is_ttl_recoverable() {
        let root = TempDir::new().unwrap();
        let mut core = lock(&root, RuntimeId::Cli);
        core.owner_evidence().unwrap();
        fs::create_dir(&core.paths.registration_mutex).unwrap();
        set_private_dir_mode(&core.paths.registration_mutex).unwrap();
        let token = core
            .paths
            .registration_mutex
            .join(format!("token-{}", Uuid::new_v4()));
        fs::create_dir(&token).unwrap();
        set_private_dir_mode(&token).unwrap();
        fs::write(
            token.join(format!("staged-mutex-{}.json", Uuid::new_v4())),
            b"{partial",
        )
        .unwrap();
        core.timing.mutex_ttl_ms = 1_000;
        core.clock_offset_ms = 2_000;
        assert!(core.register_runtime_lease().is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn incomplete_windows_mutex_without_stable_identity_is_never_deleted() {
        let root = TempDir::new().unwrap();
        let mut core = lock(&root, RuntimeId::Cli);
        core.owner_evidence().unwrap();
        fs::create_dir(&core.paths.registration_mutex).unwrap();
        let token = core
            .paths
            .registration_mutex
            .join(format!("token-{}", Uuid::new_v4()));
        fs::create_dir(&token).unwrap();
        fs::write(
            token.join(format!("staged-mutex-{}.json", Uuid::new_v4())),
            b"{partial",
        )
        .unwrap();
        core.timing.acquire_timeout_ms = 0;
        core.clock_offset_ms = 2_000;
        assert_eq!(error_code(core.register_runtime_lease()), "MUTEX_BUSY");
        assert!(core.paths.registration_mutex.exists());
    }

    #[cfg(unix)]
    #[test]
    fn generated_paths_and_records_are_private() {
        let root = TempDir::new().unwrap();
        let mut core = lock(&root, RuntimeId::BrowserDataServer);
        core.register_runtime_lease().unwrap();
        assert_eq!(
            fs::metadata(&core.paths.root).unwrap().permissions().mode() & 0o777,
            PRIVATE_DIR_MODE
        );
        assert_eq!(
            fs::metadata(&core.paths.host_identity)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            PRIVATE_FILE_MODE
        );
        for entry in fs::read_dir(&core.paths.state_records).unwrap() {
            assert_eq!(
                entry.unwrap().metadata().unwrap().permissions().mode() & 0o777,
                PRIVATE_FILE_MODE
            );
        }
    }

    #[test]
    fn sha256_path_identity_matches_node() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
