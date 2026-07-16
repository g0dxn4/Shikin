#![allow(dead_code)] // Milestone 4B0b-1 compiles/tests this core without runtime wiring.

use std::{
    collections::{BTreeSet, HashMap},
    error::Error,
    fmt,
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

#[cfg(unix)]
use std::os::unix::{
    ffi::OsStrExt,
    fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
};
#[cfg(windows)]
use std::os::windows::{
    ffi::OsStrExt,
    fs::OpenOptionsExt,
    io::{AsRawHandle, FromRawHandle},
};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use time::macros::format_description;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{HANDLE, INVALID_HANDLE_VALUE},
    Storage::FileSystem::{
        CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    },
};

const PROTOCOL: &str = "shikin.database-operation-recovery-journal";
const PROTOCOL_VERSION: u8 = 1;
const DATABASE_IDENTITY: &str = "com.asf.shikin:shikin.db";
const RECOVERY_DIRECTORY: &str = "recovery-journal-v1";
const OPERATIONS_DIRECTORY: &str = "operations";
const PRIVATE_DIR_MODE: u32 = 0o700;
const PRIVATE_WRITABLE_FILE_MODE: u32 = 0o600;
const PRIVATE_READ_ONLY_FILE_MODE: u32 = 0o400;
const MAX_JSON_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const HASH_CHUNK_SIZE: usize = 1024 * 1024;
const MAX_RECORD_BYTES: u64 = 1024 * 1024;
const MAX_ARTIFACT_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_COMMITTED_BINDING_STRING_BYTES: usize = 16_384;
const MAX_COMMITTED_BINDING_KEYS: usize = 24;
const MAX_COMMITTED_BINDING_OBJECTS: usize = 3;
const SCHEMA_CONTRACT_BYTES: &[u8] = include_bytes!("../../schema/shikin-contract.json");
const EXPECTED_SCHEMA_CONTRACT_VERSION: u64 = 1;
const EXPECTED_LATEST_MIGRATION: &str = "019_financial_semantics";
const OPERATION_KEY_DOMAIN: &[u8] =
    b"shikin.database-operation-recovery-journal/v1/operation-key\0";
const ARTIFACT_KEY_DOMAIN: &[u8] = b"shikin.database-operation-recovery-journal/v1/artifact-key\0";
const ARTIFACT_CONTENT_DOMAIN: &[u8] =
    b"shikin.database-operation-recovery-journal/v1/artifact-content\0";
const RECORD_DOMAIN: &[u8] = b"shikin.database-operation-recovery-journal/v1/record\0";

#[cfg(test)]
type InterArtifactHashTestHook = Box<dyn FnMut() -> JournalResult<()>>;
#[cfg(test)]
type InterArtifactHashTestHookSlot = std::cell::RefCell<Option<InterArtifactHashTestHook>>;

#[cfg(test)]
thread_local! {
    static INTER_ARTIFACT_HASH_TEST_HOOK: InterArtifactHashTestHookSlot =
        const { std::cell::RefCell::new(None) };
    static COMMITTED_LAYOUT_ENTRY_READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(crate) fn set_inter_artifact_hash_test_hook(hook: Option<InterArtifactHashTestHook>) {
    INTER_ARTIFACT_HASH_TEST_HOOK.with(|slot| slot.replace(hook));
}

#[cfg(test)]
fn run_inter_artifact_hash_test_hook() -> JournalResult<()> {
    INTER_ARTIFACT_HASH_TEST_HOOK.with(|slot| {
        let mut slot = slot.borrow_mut();
        match slot.as_mut() {
            Some(hook) => hook(),
            None => Ok(()),
        }
    })
}

#[cfg(not(test))]
fn run_inter_artifact_hash_test_hook() -> JournalResult<()> {
    Ok(())
}

#[derive(Debug)]
pub(crate) struct JournalError {
    code: &'static str,
    message: String,
    source: Option<Box<dyn Error + Send + Sync>>,
}

impl JournalError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
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

    fn filesystem(context: &str, error: io::Error) -> Self {
        Self::with_source(
            "RECOVERY_FILESYSTEM_FAILURE",
            format!("{context}: {error}"),
            error,
        )
    }

    fn durability(context: &str, error: io::Error) -> Self {
        Self::with_source(
            "RECOVERY_DURABILITY_FAILURE",
            format!("{context}: {error}"),
            error,
        )
    }

    pub(crate) fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for JournalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl Error for JournalError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.source
            .as_deref()
            .map(|source| source as &(dyn Error + 'static))
    }
}

pub(crate) type JournalResult<T> = Result<T, JournalError>;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RecoveryOperation {
    Restore,
    Import,
}

impl RecoveryOperation {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Restore => "restore",
            Self::Import => "import",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum JournalIntentPhase {
    Registered,
    Draining,
    Exclusive,
    Mutating,
    Completed,
    Abandoned,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CommittedRecoveryPhase {
    Mutating,
    Abandoned,
}

impl CommittedRecoveryPhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mutating => "mutating",
            Self::Abandoned => "abandoned",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum JournalRuntimeId {
    Cli,
    Mcp,
    BrowserDataServer,
    Tauri,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JournalOwnerEvidence {
    owner_id: String,
    runtime_id: JournalRuntimeId,
    host_id: String,
    process_id: u32,
    process_started_at: String,
}

impl JournalOwnerEvidence {
    pub(crate) fn new(
        owner_id: String,
        runtime_id: JournalRuntimeId,
        host_id: String,
        process_id: u32,
        process_started_at: String,
    ) -> JournalResult<Self> {
        if !valid_identifier(&owner_id)
            || !valid_identifier(&host_id)
            || process_id == 0
            || !valid_timestamp(&process_started_at)
        {
            return Err(JournalError::new(
                "INVALID_RECOVERY_OPTIONS",
                "owner evidence is malformed",
            ));
        }
        Ok(Self {
            owner_id,
            runtime_id,
            host_id,
            process_id,
            process_started_at,
        })
    }

    pub(crate) fn owner_id(&self) -> &str {
        &self.owner_id
    }

    pub(crate) fn runtime_id(&self) -> JournalRuntimeId {
        self.runtime_id
    }

    pub(crate) fn host_id(&self) -> &str {
        &self.host_id
    }

    pub(crate) fn process_id(&self) -> u32 {
        self.process_id
    }

    pub(crate) fn process_started_at(&self) -> &str {
        &self.process_started_at
    }
}

#[derive(Clone, Debug)]
pub(crate) struct JournalIntentBinding {
    database_identity: String,
    state_revision: u64,
    operation_id: String,
    operation: RecoveryOperation,
    owner: JournalOwnerEvidence,
    fencing_generation: u64,
    phase: JournalIntentPhase,
    intent_created_at: String,
    intent_updated_at: String,
    intent_metadata: Option<JsonValue>,
}

impl JournalIntentBinding {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        database_identity: String,
        state_revision: u64,
        operation_id: String,
        operation: RecoveryOperation,
        owner: JournalOwnerEvidence,
        fencing_generation: u64,
        phase: JournalIntentPhase,
        intent_created_at: String,
        intent_updated_at: String,
        intent_metadata: Option<JsonValue>,
    ) -> JournalResult<Self> {
        let intent_metadata = intent_metadata
            .as_ref()
            .map(normalize_intent_metadata_value)
            .transpose()?;
        if database_identity != DATABASE_IDENTITY
            || state_revision > MAX_JSON_SAFE_INTEGER
            || !valid_identifier(&operation_id)
            || fencing_generation == 0
            || fencing_generation > MAX_JSON_SAFE_INTEGER
            || phase != JournalIntentPhase::Exclusive
            || !valid_timestamp(&intent_created_at)
            || !valid_timestamp(&intent_updated_at)
            || !valid_intent_metadata(&intent_metadata)
        {
            return Err(JournalError::new(
                "INVALID_RECOVERY_OPTIONS",
                "binding must be the fixed database identity and an exclusive restore/import intent",
            ));
        }
        Ok(Self {
            database_identity,
            state_revision,
            operation_id,
            operation,
            owner,
            fencing_generation,
            phase,
            intent_created_at,
            intent_updated_at,
            intent_metadata,
        })
    }

    pub(crate) fn database_identity(&self) -> &str {
        &self.database_identity
    }

    pub(crate) fn state_revision(&self) -> u64 {
        self.state_revision
    }

    pub(crate) fn operation_id(&self) -> &str {
        &self.operation_id
    }

    pub(crate) fn operation(&self) -> RecoveryOperation {
        self.operation
    }

    pub(crate) fn owner(&self) -> &JournalOwnerEvidence {
        &self.owner
    }

    pub(crate) fn fencing_generation(&self) -> u64 {
        self.fencing_generation
    }

    pub(crate) fn phase(&self) -> JournalIntentPhase {
        self.phase
    }

    pub(crate) fn intent_created_at(&self) -> &str {
        &self.intent_created_at
    }

    pub(crate) fn intent_updated_at(&self) -> &str {
        &self.intent_updated_at
    }

    pub(crate) fn intent_metadata(&self) -> Option<&JsonValue> {
        self.intent_metadata.as_ref()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ArtifactRole {
    Candidate,
    Rollback,
}

impl ArtifactRole {
    fn all() -> [Self; 2] {
        [Self::Candidate, Self::Rollback]
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Candidate => "candidate",
            Self::Rollback => "rollback",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArtifactChecks {
    integrity_check: String,
    foreign_key_check: String,
    schema_contract_check: String,
    sidecar_check: String,
}

impl ArtifactChecks {
    pub(crate) fn new(
        integrity_check: String,
        foreign_key_check: String,
        schema_contract_check: String,
        sidecar_check: String,
    ) -> JournalResult<Self> {
        let checks = Self {
            integrity_check,
            foreign_key_check,
            schema_contract_check,
            sidecar_check,
        };
        checks.validate()?;
        Ok(checks)
    }

    pub(crate) fn all_ok() -> Self {
        Self {
            integrity_check: "ok".into(),
            foreign_key_check: "ok".into(),
            schema_contract_check: "ok".into(),
            sidecar_check: "ok".into(),
        }
    }

    fn validate(&self) -> JournalResult<()> {
        if self.integrity_check == "ok"
            && self.foreign_key_check == "ok"
            && self.schema_contract_check == "ok"
            && self.sidecar_check == "ok"
        {
            Ok(())
        } else {
            Err(JournalError::new(
                "RECOVERY_VALIDATION_FAILED",
                "artifact callback must return the exact four ok checks",
            ))
        }
    }

    pub(crate) fn integrity_check(&self) -> &str {
        &self.integrity_check
    }

    pub(crate) fn foreign_key_check(&self) -> &str {
        &self.foreign_key_check
    }

    pub(crate) fn schema_contract_check(&self) -> &str {
        &self.schema_contract_check
    }

    pub(crate) fn sidecar_check(&self) -> &str {
        &self.sidecar_check
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SchemaContractIdentity {
    raw_bytes_sha256: String,
    contract_version: u64,
    latest_migration: String,
}

impl SchemaContractIdentity {
    pub(crate) fn raw_bytes_sha256(&self) -> &str {
        &self.raw_bytes_sha256
    }

    pub(crate) fn contract_version(&self) -> u64 {
        self.contract_version
    }

    pub(crate) fn latest_migration(&self) -> &str {
        &self.latest_migration
    }
}

pub(crate) struct ArtifactWriteContext<'a> {
    role: ArtifactRole,
    path: &'a Path,
    operation_id: &'a str,
    operation: RecoveryOperation,
    schema_contract_identity: &'a SchemaContractIdentity,
}

impl<'a> ArtifactWriteContext<'a> {
    pub(crate) fn role(&self) -> ArtifactRole {
        self.role
    }

    pub(crate) fn path(&self) -> &Path {
        self.path
    }

    pub(crate) fn operation_id(&self) -> &str {
        self.operation_id
    }

    pub(crate) fn operation(&self) -> RecoveryOperation {
        self.operation
    }

    pub(crate) fn schema_contract_identity(&self) -> &SchemaContractIdentity {
        self.schema_contract_identity
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum JournalDurability {
    LinuxFsyncComplete,
}

impl JournalDurability {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::LinuxFsyncComplete => "linux-fsync-complete",
        }
    }
}

#[derive(Debug)]
struct ProofLifecycle {
    used: bool,
    active: bool,
}

#[derive(Debug)]
pub(crate) struct PreparedMutationProof {
    binding: JournalIntentBinding,
    operation_root: PathBuf,
    operation_path: PathBuf,
    commitment_sha256: String,
    durability: JournalDurability,
    lifecycle: Arc<Mutex<ProofLifecycle>>,
}

#[derive(Debug)]
pub(crate) struct PreparedMutationJournal {
    proof: PreparedMutationProof,
    commitment_sha256: String,
    durability: JournalDurability,
}

impl PreparedMutationJournal {
    pub(crate) fn proof(&self) -> &PreparedMutationProof {
        &self.proof
    }

    pub(crate) fn commitment_sha256(&self) -> &str {
        &self.commitment_sha256
    }

    pub(crate) fn durability(&self) -> JournalDurability {
        self.durability
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedCommitment {
    sha256: String,
    durability: JournalDurability,
}

impl PreparedCommitment {
    pub(crate) fn sha256(&self) -> &str {
        &self.sha256
    }

    pub(crate) fn durability(&self) -> JournalDurability {
        self.durability
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VerificationMode {
    Prepared,
    Committed,
}

impl VerificationMode {
    fn retained_io_error(
        self,
        code: &'static str,
        context: &str,
        error: io::Error,
    ) -> JournalError {
        match self {
            Self::Prepared => JournalError::with_source(code, format!("{context}: {error}"), error),
            Self::Committed => JournalError::filesystem(context, error),
        }
    }

    fn preserves_filesystem_failure(self) -> bool {
        matches!(self, Self::Committed)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VerifiedTokenLifecycle {
    Active,
    Released,
    Consumed,
}

#[derive(Debug)]
pub(crate) struct VerifiedPreparedMutationToken {
    proof_lifecycle: Arc<Mutex<ProofLifecycle>>,
    binding: JournalIntentBinding,
    commitment: PreparedCommitment,
    retained_evidence: Option<RetainedOperationEvidence>,
    lifecycle: VerifiedTokenLifecycle,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CommittedEvidenceTokenLifecycle {
    Active,
    Released,
}

#[derive(Debug)]
pub(crate) struct VerifiedCommittedRecoveryEvidenceToken {
    binding: CommittedRecoveryEvidenceBinding,
    commitment: PreparedCommitment,
    retained_evidence: Option<RetainedOperationEvidence>,
    lifecycle: CommittedEvidenceTokenLifecycle,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArtifactRecord {
    path: String,
    content_digest: String,
    size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArtifactCheckPair {
    candidate: ArtifactChecks,
    rollback: ArtifactChecks,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum PreparedMutationKind {
    PreparedMutation,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreparedRecord {
    protocol: String,
    protocol_version: u8,
    record_kind: PreparedMutationKind,
    sequence: u64,
    previous_record_sha256: Option<String>,
    database_identity: String,
    operation_id: String,
    operation: RecoveryOperation,
    owner: JournalOwnerEvidence,
    fencing_generation: u64,
    created_at: String,
    nonce: String,
    candidate: ArtifactRecord,
    rollback: ArtifactRecord,
    schema_contract: SchemaContractIdentity,
    checks: ArtifactCheckPair,
}

impl PreparedRecord {
    fn artifact(&self, role: ArtifactRole) -> &ArtifactRecord {
        match role {
            ArtifactRole::Candidate => &self.candidate,
            ArtifactRole::Rollback => &self.rollback,
        }
    }
}

#[derive(Clone, Debug)]
struct JournalPaths {
    operation_root: PathBuf,
    recovery_root: PathBuf,
    operations: PathBuf,
    operation_key: String,
    operation: PathBuf,
    artifacts: PathBuf,
    records: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StableIdentity {
    first: u64,
    second: u64,
}

#[derive(Clone, Debug)]
struct DirectoryIdentity {
    path: PathBuf,
    stable: StableIdentity,
}

#[derive(Debug)]
struct FileInspection {
    stable: StableIdentity,
    links: u64,
    is_file: bool,
    is_directory: bool,
    is_reparse: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ArtifactSnapshot {
    size: u64,
    #[cfg(target_os = "linux")]
    modified_seconds: i64,
    #[cfg(target_os = "linux")]
    modified_nanoseconds: i64,
    #[cfg(target_os = "linux")]
    changed_seconds: i64,
    #[cfg(target_os = "linux")]
    changed_nanoseconds: i64,
}

struct OpenArtifactEvidence {
    file: File,
    path: PathBuf,
    identity: StableIdentity,
    snapshot: ArtifactSnapshot,
    role: ArtifactRole,
    expected_size: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RetainedStatSnapshot {
    stable: StableIdentity,
    links: u64,
    mode: u32,
    size: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

#[derive(Debug)]
struct RetainedDirectoryEvidence {
    file: File,
    path: PathBuf,
    label: String,
    code: &'static str,
    mutable: bool,
    snapshot: RetainedStatSnapshot,
}

#[derive(Debug)]
struct RetainedFileEvidence {
    file: File,
    path: PathBuf,
    label: String,
    code: &'static str,
    role: Option<ArtifactRole>,
    expected_size: Option<u64>,
    snapshot: RetainedStatSnapshot,
}

#[derive(Debug)]
struct RetainedLayout {
    path: PathBuf,
    expected: Vec<String>,
    code: &'static str,
}

#[derive(Debug)]
struct RetainedOperationEvidence {
    verification_mode: VerificationMode,
    directories: Vec<RetainedDirectoryEvidence>,
    files: Vec<RetainedFileEvidence>,
    layouts: Vec<RetainedLayout>,
}

#[derive(Debug)]
struct CompleteEvidence {
    commitment_sha256: String,
    durability: JournalDurability,
}

pub(crate) fn prepare_mutation_journal<F>(
    operation_root: &Path,
    binding: &JournalIntentBinding,
    mut write_artifact: F,
) -> JournalResult<PreparedMutationJournal>
where
    F: FnMut(ArtifactWriteContext<'_>) -> JournalResult<ArtifactChecks>,
{
    validate_binding(binding)?;
    validate_operation_root_argument(operation_root)?;
    require_linux_durability()?;
    let root_identity = validate_operation_root(operation_root)?;
    let schema_identity = trusted_schema_identity()?;
    let paths = journal_paths(operation_root, binding);
    let parent_identities = ensure_journal_parents(&paths, &root_identity)?;

    if path_exists(&paths.operation)? {
        return Err(JournalError::new(
            "RECOVERY_PREPARATION_INCOMPLETE",
            "an operation directory already exists and must not be read, modified, or reused",
        ));
    }

    let mut directory_identities = parent_identities;
    directory_identities.extend([
        create_private_directory(&paths.operation, FaultPoint::AfterOperationDirectoryCreate)?,
        create_private_directory(&paths.artifacts, FaultPoint::AfterArtifactsDirectoryCreate)?,
        create_private_directory(&paths.records, FaultPoint::AfterRecordsDirectoryCreate)?,
    ]);

    let mut nonce_bytes = [0u8; 32];
    getrandom::fill(&mut nonce_bytes).map_err(|error| {
        JournalError::new(
            "RECOVERY_FILESYSTEM_FAILURE",
            format!("generate recovery nonce: {error}"),
        )
    })?;
    let nonce = hex(&nonce_bytes);

    let mut artifacts = HashMap::new();
    let mut checks = HashMap::new();
    for role in ArtifactRole::all() {
        let artifact_key = artifact_key(&paths.operation_key, &nonce, role);
        let filename = format!("{}-{artifact_key}.sqlite", role.as_str());
        let path = paths.artifacts.join(&filename);
        let result =
            write_prepared_artifact(role, &path, binding, &schema_identity, &mut write_artifact)?;
        artifacts.insert(
            role.as_str(),
            ArtifactRecord {
                path: format!("artifacts/{filename}"),
                content_digest: result.0,
                size_bytes: result.1,
            },
        );
        checks.insert(role.as_str(), result.2);
    }

    let candidate = artifacts.remove("candidate").ok_or_else(|| {
        JournalError::new(
            "RECOVERY_VALIDATION_FAILED",
            "candidate artifact result is missing",
        )
    })?;
    let rollback = artifacts.remove("rollback").ok_or_else(|| {
        JournalError::new(
            "RECOVERY_VALIDATION_FAILED",
            "rollback artifact result is missing",
        )
    })?;
    assert_exact_entries(
        &paths.artifacts,
        &[
            artifact_filename(&candidate)?,
            artifact_filename(&rollback)?,
        ],
        "RECOVERY_ARTIFACT_CORRUPTION",
    )?;
    assert_no_sidecars(&paths.artifacts)?;

    let record = PreparedRecord {
        protocol: PROTOCOL.into(),
        protocol_version: PROTOCOL_VERSION,
        record_kind: PreparedMutationKind::PreparedMutation,
        sequence: 0,
        previous_record_sha256: None,
        database_identity: DATABASE_IDENTITY.into(),
        operation_id: binding.operation_id.clone(),
        operation: binding.operation,
        owner: binding.owner.clone(),
        fencing_generation: binding.fencing_generation,
        created_at: binding.intent_created_at.clone(),
        nonce,
        candidate,
        rollback,
        schema_contract: schema_identity,
        checks: ArtifactCheckPair {
            candidate: checks.remove("candidate").ok_or_else(|| {
                JournalError::new(
                    "RECOVERY_VALIDATION_FAILED",
                    "candidate artifact checks are missing",
                )
            })?,
            rollback: checks.remove("rollback").ok_or_else(|| {
                JournalError::new(
                    "RECOVERY_VALIDATION_FAILED",
                    "rollback artifact checks are missing",
                )
            })?,
        },
    };
    let canonical = canonical_record_bytes(&record)?;
    let commitment_sha256 = record_hash(&canonical);
    let record_path = paths
        .records
        .join(format!("00000000000000000000-{commitment_sha256}.json"));
    write_prepared_record(&record_path, &canonical)?;

    let durability = finish_durability(&paths)?;
    for identity in &directory_identities {
        revalidate_directory_identity(identity)?;
    }
    revalidate_directory_identity(&root_identity)?;
    let evidence = validate_complete_operation(&paths, binding)?;
    if evidence.commitment_sha256 != commitment_sha256 {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "prepared record commitment changed",
        ));
    }
    Ok(mint_prepared(binding, &paths, evidence, durability))
}

pub(crate) fn verify_prepared_mutation_proof(
    proof: &PreparedMutationProof,
    operation_root: &Path,
    binding: &JournalIntentBinding,
) -> JournalResult<VerifiedPreparedMutationToken> {
    let mut lifecycle = lock_proof_lifecycle(&proof.lifecycle);
    if lifecycle.used {
        return Err(JournalError::new(
            "PREPARED_PROOF_USED",
            "prepared proof was already consumed",
        ));
    }
    if lifecycle.active {
        return Err(JournalError::new(
            "PREPARED_PROOF_ACTIVE",
            "prepared proof already has an active verifier",
        ));
    }
    validate_binding(binding)?;
    if &proof.binding != binding {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "prepared proof binding does not match",
        ));
    }
    validate_operation_root_argument(operation_root)?;
    if !paths_equal(operation_root, &proof.operation_root) {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "prepared proof operation root does not match",
        ));
    }
    require_linux_durability()?;
    let paths = journal_paths(operation_root, binding);
    if proof.operation_path != paths.operation {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "prepared proof operation path does not match",
        ));
    }
    let (evidence, retained_evidence) =
        validate_and_retain_complete_operation(&paths, binding, run_inter_artifact_hash_test_hook)?;
    if evidence.commitment_sha256 != proof.commitment_sha256
        || evidence.durability != proof.durability
    {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "prepared proof commitment does not match",
        ));
    }
    lifecycle.active = true;
    drop(lifecycle);
    Ok(VerifiedPreparedMutationToken {
        proof_lifecycle: Arc::clone(&proof.lifecycle),
        binding: binding.clone(),
        commitment: PreparedCommitment {
            sha256: evidence.commitment_sha256,
            durability: evidence.durability,
        },
        retained_evidence: Some(retained_evidence),
        lifecycle: VerifiedTokenLifecycle::Active,
    })
}

pub(crate) fn revalidate_verified_prepared_mutation_token(
    token: &VerifiedPreparedMutationToken,
    binding: &JournalIntentBinding,
) -> JournalResult<PreparedCommitment> {
    let lifecycle = lock_proof_lifecycle(&token.proof_lifecycle);
    if lifecycle.used {
        return Err(JournalError::new(
            "PREPARED_PROOF_USED",
            "prepared proof was already consumed",
        ));
    }
    if token.lifecycle != VerifiedTokenLifecycle::Active || !lifecycle.active {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "verified token is not active",
        ));
    }
    drop(lifecycle);
    validate_binding(binding)?;
    if &token.binding != binding {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "verified token binding does not match",
        ));
    }
    require_linux_durability()?;
    revalidate_retained_operation_evidence(token.retained_evidence.as_ref().ok_or_else(|| {
        JournalError::new(
            "PREPARED_PROOF_INVALID",
            "verified token has no retained evidence",
        )
    })?)?;
    Ok(token.commitment.clone())
}

pub(crate) fn release_verified_prepared_mutation_token(token: &mut VerifiedPreparedMutationToken) {
    if token.lifecycle != VerifiedTokenLifecycle::Active {
        return;
    }
    token.lifecycle = VerifiedTokenLifecycle::Released;
    lock_proof_lifecycle(&token.proof_lifecycle).active = false;
    let _closed_after_state_change = token.retained_evidence.take();
}

pub(crate) fn consume_verified_prepared_mutation_token(token: &mut VerifiedPreparedMutationToken) {
    if token.lifecycle != VerifiedTokenLifecycle::Active {
        return;
    }
    token.lifecycle = VerifiedTokenLifecycle::Consumed;
    {
        let mut lifecycle = lock_proof_lifecycle(&token.proof_lifecycle);
        lifecycle.used = true;
        lifecycle.active = false;
    }
    let _closed_after_state_change = token.retained_evidence.take();
}

impl Drop for VerifiedPreparedMutationToken {
    fn drop(&mut self) {
        release_verified_prepared_mutation_token(self);
    }
}

pub(crate) fn verify_committed_recovery_evidence(
    binding: &CommittedRecoveryEvidenceBinding,
) -> JournalResult<VerifiedCommittedRecoveryEvidenceToken> {
    validate_committed_binding(binding)?;
    require_linux_durability()?;
    let paths = journal_paths_for(&binding.operation_root, &binding.operation_id);
    let (evidence, retained_evidence) = validate_and_retain_committed_recovery_operation(
        &paths,
        binding,
        run_inter_artifact_hash_test_hook,
    )?;
    Ok(VerifiedCommittedRecoveryEvidenceToken {
        binding: binding.clone(),
        commitment: PreparedCommitment {
            sha256: evidence.commitment_sha256,
            durability: evidence.durability,
        },
        retained_evidence: Some(retained_evidence),
        lifecycle: CommittedEvidenceTokenLifecycle::Active,
    })
}

pub(crate) fn revalidate_verified_committed_recovery_evidence_token(
    token: &VerifiedCommittedRecoveryEvidenceToken,
    binding: &CommittedRecoveryEvidenceBinding,
) -> JournalResult<PreparedCommitment> {
    if token.lifecycle != CommittedEvidenceTokenLifecycle::Active {
        return Err(JournalError::new(
            "RECOVERY_EVIDENCE_TOKEN_RELEASED",
            "committed recovery evidence token was released",
        ));
    }
    validate_committed_binding(binding)?;
    if &token.binding != binding {
        return Err(JournalError::new(
            "RECOVERY_EVIDENCE_BINDING_MISMATCH",
            "committed recovery evidence token binding does not match",
        ));
    }
    require_linux_durability()?;
    revalidate_retained_operation_evidence(token.retained_evidence.as_ref().ok_or_else(|| {
        JournalError::new(
            "RECOVERY_EVIDENCE_TOKEN_RELEASED",
            "committed recovery evidence token has no retained evidence",
        )
    })?)?;
    Ok(token.commitment.clone())
}

pub(crate) fn release_verified_committed_recovery_evidence_token(
    token: &mut VerifiedCommittedRecoveryEvidenceToken,
) {
    if token.lifecycle != CommittedEvidenceTokenLifecycle::Active {
        return;
    }
    token.lifecycle = CommittedEvidenceTokenLifecycle::Released;
    let _closed_after_state_change = token.retained_evidence.take();
}

impl Drop for VerifiedCommittedRecoveryEvidenceToken {
    fn drop(&mut self) {
        release_verified_committed_recovery_evidence_token(self);
    }
}

fn lock_proof_lifecycle(lifecycle: &Arc<Mutex<ProofLifecycle>>) -> MutexGuard<'_, ProofLifecycle> {
    lifecycle
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl PartialEq for JournalIntentBinding {
    fn eq(&self, other: &Self) -> bool {
        self.database_identity == other.database_identity
            && self.state_revision == other.state_revision
            && self.operation_id == other.operation_id
            && self.operation == other.operation
            && self.owner == other.owner
            && self.fencing_generation == other.fencing_generation
            && self.phase == other.phase
            && self.intent_created_at == other.intent_created_at
            && self.intent_updated_at == other.intent_updated_at
            && self.intent_metadata == other.intent_metadata
    }
}

impl Eq for JournalIntentBinding {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CommittedRecoveryCommitment {
    protocol: String,
    version: u64,
    record_sha256: String,
    durability: String,
    claim_sequence: u64,
}

impl CommittedRecoveryCommitment {
    pub(crate) fn new(
        protocol: String,
        version: u64,
        record_sha256: String,
        durability: String,
        claim_sequence: u64,
    ) -> JournalResult<Self> {
        if protocol != PROTOCOL
            || version != u64::from(PROTOCOL_VERSION)
            || !is_lower_hex_64(&record_sha256)
            || durability != "linux-fsync-complete"
            || claim_sequence > MAX_JSON_SAFE_INTEGER
        {
            return Err(JournalError::new(
                "RECOVERY_COMMITMENT_INVALID",
                "committed recovery metadata is malformed",
            ));
        }
        Ok(Self {
            protocol,
            version,
            record_sha256,
            durability,
            claim_sequence,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CommittedRecoveryEvidenceBinding {
    operation_root: PathBuf,
    database_identity: String,
    state_revision: u64,
    operation_id: String,
    operation: RecoveryOperation,
    phase: CommittedRecoveryPhase,
    owner: JournalOwnerEvidence,
    fencing_generation: u64,
    created_at: String,
    updated_at: String,
    recovery_commitment: CommittedRecoveryCommitment,
}

impl CommittedRecoveryEvidenceBinding {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        operation_root: PathBuf,
        database_identity: String,
        state_revision: u64,
        operation_id: String,
        operation: RecoveryOperation,
        phase: CommittedRecoveryPhase,
        owner: JournalOwnerEvidence,
        fencing_generation: u64,
        created_at: String,
        updated_at: String,
        recovery_commitment: CommittedRecoveryCommitment,
    ) -> JournalResult<Self> {
        let binding = Self {
            operation_root,
            database_identity,
            state_revision,
            operation_id,
            operation,
            phase,
            owner,
            fencing_generation,
            created_at,
            updated_at,
            recovery_commitment,
        };
        validate_committed_binding(&binding)?;
        Ok(binding)
    }
}

fn validate_binding(binding: &JournalIntentBinding) -> JournalResult<()> {
    if binding.database_identity != DATABASE_IDENTITY
        || binding.state_revision > MAX_JSON_SAFE_INTEGER
        || !valid_identifier(&binding.operation_id)
        || binding.fencing_generation == 0
        || binding.fencing_generation > MAX_JSON_SAFE_INTEGER
        || binding.phase != JournalIntentPhase::Exclusive
        || !valid_timestamp(&binding.intent_created_at)
        || !valid_timestamp(&binding.intent_updated_at)
        || !valid_intent_metadata(&binding.intent_metadata)
    {
        Err(JournalError::new(
            "INVALID_RECOVERY_OPTIONS",
            "journal binding is malformed",
        ))
    } else {
        Ok(())
    }
}

fn validate_committed_binding(binding: &CommittedRecoveryEvidenceBinding) -> JournalResult<()> {
    validate_operation_root_argument(&binding.operation_root)?;
    if binding.database_identity != DATABASE_IDENTITY
        || binding.state_revision > MAX_JSON_SAFE_INTEGER
        || !valid_identifier(&binding.operation_id)
        || !valid_timestamp(&binding.created_at)
        || !valid_timestamp(&binding.updated_at)
        || binding.owner.owner_id.is_empty()
        || !valid_identifier(&binding.owner.owner_id)
        || !valid_identifier(&binding.owner.host_id)
        || binding.owner.process_id == 0
        || !valid_timestamp(&binding.owner.process_started_at)
    {
        return Err(JournalError::new(
            "INVALID_RECOVERY_OPTIONS",
            "committed recovery binding is malformed",
        ));
    }
    if binding.recovery_commitment.protocol != PROTOCOL
        || binding.recovery_commitment.version != u64::from(PROTOCOL_VERSION)
        || !is_lower_hex_64(&binding.recovery_commitment.record_sha256)
        || binding.recovery_commitment.durability != "linux-fsync-complete"
        || binding.recovery_commitment.claim_sequence > MAX_JSON_SAFE_INTEGER
    {
        return Err(JournalError::new(
            "RECOVERY_COMMITMENT_INVALID",
            "committed recovery metadata is malformed",
        ));
    }
    validate_committed_binding_limits(binding)?;
    if binding.fencing_generation == 0
        || binding.fencing_generation > MAX_JSON_SAFE_INTEGER
        || binding.fencing_generation <= binding.recovery_commitment.claim_sequence
    {
        return Err(JournalError::new(
            "RECOVERY_LINEAGE_INVALID",
            "committed recovery phase or generation lineage is invalid",
        ));
    }
    Ok(())
}

fn validate_committed_binding_limits(
    binding: &CommittedRecoveryEvidenceBinding,
) -> JournalResult<()> {
    const FIXED_KEY_COUNT: usize = 3 + 9 + 5 + 5;
    if FIXED_KEY_COUNT > MAX_COMMITTED_BINDING_KEYS || MAX_COMMITTED_BINDING_OBJECTS != 3 {
        return Err(JournalError::new(
            "INVALID_RECOVERY_OPTIONS",
            "committed recovery binding shape is too large",
        ));
    }
    let operation_root = binding.operation_root.to_str().ok_or_else(|| {
        JournalError::new(
            "INVALID_RECOVERY_OPTIONS",
            "committed recovery operation root must be UTF-8",
        )
    })?;
    let runtime_id = match binding.owner.runtime_id {
        JournalRuntimeId::Cli => "cli",
        JournalRuntimeId::Mcp => "mcp",
        JournalRuntimeId::BrowserDataServer => "browser-data-server",
        JournalRuntimeId::Tauri => "tauri",
    };
    let strings = [
        operation_root,
        DATABASE_IDENTITY,
        "exclusive_intent",
        binding.operation_id.as_str(),
        binding.operation.as_str(),
        binding.phase.as_str(),
        binding.owner.owner_id.as_str(),
        runtime_id,
        binding.owner.host_id.as_str(),
        binding.owner.process_started_at.as_str(),
        binding.created_at.as_str(),
        binding.updated_at.as_str(),
        binding.recovery_commitment.protocol.as_str(),
        binding.recovery_commitment.record_sha256.as_str(),
        binding.recovery_commitment.durability.as_str(),
    ];
    let total = strings.iter().try_fold(0usize, |total, value| {
        total.checked_add(value.len()).ok_or_else(|| {
            JournalError::new(
                "INVALID_RECOVERY_OPTIONS",
                "committed recovery binding string bytes overflowed",
            )
        })
    })?;
    if total > MAX_COMMITTED_BINDING_STRING_BYTES {
        return Err(JournalError::new(
            "INVALID_RECOVERY_OPTIONS",
            "committed recovery binding exceeds the scalar string byte limit",
        ));
    }
    Ok(())
}

#[cfg(all(test, not(target_os = "linux")))]
pub(crate) fn forged_prepared_mutation_proof_for_unsupported_platform_test(
    operation_root: &Path,
    binding: &JournalIntentBinding,
) -> PreparedMutationProof {
    let paths = journal_paths(operation_root, binding);
    PreparedMutationProof {
        binding: binding.clone(),
        operation_root: operation_root.to_path_buf(),
        operation_path: paths.operation,
        commitment_sha256: "a".repeat(64),
        durability: JournalDurability::LinuxFsyncComplete,
        lifecycle: Arc::new(Mutex::new(ProofLifecycle {
            used: false,
            active: false,
        })),
    }
}

fn mint_prepared(
    binding: &JournalIntentBinding,
    paths: &JournalPaths,
    evidence: CompleteEvidence,
    durability: JournalDurability,
) -> PreparedMutationJournal {
    PreparedMutationJournal {
        proof: PreparedMutationProof {
            binding: binding.clone(),
            operation_root: paths.operation_root.clone(),
            operation_path: paths.operation.clone(),
            commitment_sha256: evidence.commitment_sha256.clone(),
            durability,
            lifecycle: Arc::new(Mutex::new(ProofLifecycle {
                used: false,
                active: false,
            })),
        },
        commitment_sha256: evidence.commitment_sha256,
        durability,
    }
}

fn write_prepared_artifact<F>(
    role: ArtifactRole,
    path: &Path,
    binding: &JournalIntentBinding,
    schema_identity: &SchemaContractIdentity,
    write_artifact: &mut F,
) -> JournalResult<(String, u64, ArtifactChecks)>
where
    F: FnMut(ArtifactWriteContext<'_>) -> JournalResult<ArtifactChecks>,
{
    let mut file = open_exclusive_file(path)?;
    inject_fault(match role {
        ArtifactRole::Candidate => FaultPoint::AfterCandidateArtifactCreate,
        ArtifactRole::Rollback => FaultPoint::AfterRollbackArtifactCreate,
    })?;
    let reserved = inspect_open_regular_file(
        &file,
        path,
        "reserved artifact",
        "RECOVERY_ARTIFACT_CORRUPTION",
        false,
    )?;
    let checks = match write_artifact(ArtifactWriteContext {
        role,
        path,
        operation_id: &binding.operation_id,
        operation: binding.operation,
        schema_contract_identity: schema_identity,
    }) {
        Ok(checks) => checks,
        Err(error) => {
            #[cfg(test)]
            if error.code() == "RECOVERY_TEST_FAULT" {
                return Err(error);
            }
            return Err(JournalError::new(
                "RECOVERY_VALIDATION_FAILED",
                format!("{} artifact callback failed: {error}", role.as_str()),
            ));
        }
    };
    inject_fault(match role {
        ArtifactRole::Candidate => FaultPoint::AfterCandidateArtifactCallback,
        ArtifactRole::Rollback => FaultPoint::AfterRollbackArtifactCallback,
    })?;
    checks.validate()?;
    revalidate_open_regular_file(
        &file,
        path,
        &reserved,
        "artifact",
        "RECOVERY_ARTIFACT_CORRUPTION",
        false,
    )?;
    flush_and_seal_file(
        &file,
        path,
        &reserved,
        "artifact",
        "RECOVERY_ARTIFACT_CORRUPTION",
    )?;
    inject_fault(match role {
        ArtifactRole::Candidate => FaultPoint::AfterCandidateArtifactFsync,
        ArtifactRole::Rollback => FaultPoint::AfterRollbackArtifactFsync,
    })?;
    let (digest, size) = hash_open_artifact(
        &mut file,
        path,
        &reserved,
        role,
        None,
        VerificationMode::Prepared,
    )?;
    Ok((digest, size, checks))
}

fn write_prepared_record(path: &Path, canonical: &[u8]) -> JournalResult<()> {
    let mut file = open_exclusive_file(path)?;
    inject_fault(FaultPoint::AfterRecordCreate)?;
    let reserved = inspect_open_regular_file(
        &file,
        path,
        "reserved record",
        "RECOVERY_JOURNAL_CORRUPTION",
        false,
    )?;
    file.write_all(canonical)
        .and_then(|()| file.write_all(b"\n"))
        .map_err(|error| JournalError::filesystem("write prepared record", error))?;
    inject_fault(FaultPoint::AfterRecordWrite)?;
    revalidate_open_regular_file(
        &file,
        path,
        &reserved,
        "record",
        "RECOVERY_JOURNAL_CORRUPTION",
        false,
    )?;
    flush_and_seal_file(
        &file,
        path,
        &reserved,
        "prepared record",
        "RECOVERY_JOURNAL_CORRUPTION",
    )?;
    inject_fault(FaultPoint::AfterRecordFsync)
}

#[derive(Clone, Copy)]
enum CompleteRecordBinding<'a> {
    Prepared(&'a JournalIntentBinding),
    Committed(&'a CommittedRecoveryEvidenceBinding),
}

impl CompleteRecordBinding<'_> {
    fn verification_mode(self) -> VerificationMode {
        match self {
            Self::Prepared(_) => VerificationMode::Prepared,
            Self::Committed(_) => VerificationMode::Committed,
        }
    }
}

fn validate_complete_operation(
    paths: &JournalPaths,
    binding: &JournalIntentBinding,
) -> JournalResult<CompleteEvidence> {
    #[cfg(test)]
    return validate_complete_operation_with_hook(
        paths,
        binding,
        run_inter_artifact_hash_test_hook,
    );
    #[cfg(not(test))]
    validate_complete_operation_with_hook(paths, binding, || Ok(()))
}

fn validate_complete_operation_with_hook<F>(
    paths: &JournalPaths,
    binding: &JournalIntentBinding,
    between_artifact_hashes: F,
) -> JournalResult<CompleteEvidence>
where
    F: FnMut() -> JournalResult<()>,
{
    let (evidence, retained) =
        validate_and_retain_complete_operation(paths, binding, between_artifact_hashes)?;
    drop(retained);
    Ok(evidence)
}

fn validate_and_retain_complete_operation<F>(
    paths: &JournalPaths,
    binding: &JournalIntentBinding,
    between_artifact_hashes: F,
) -> JournalResult<(CompleteEvidence, RetainedOperationEvidence)>
where
    F: FnMut() -> JournalResult<()>,
{
    validate_and_retain_complete_operation_for(
        paths,
        CompleteRecordBinding::Prepared(binding),
        between_artifact_hashes,
    )
}

fn validate_and_retain_committed_recovery_operation<F>(
    paths: &JournalPaths,
    binding: &CommittedRecoveryEvidenceBinding,
    between_artifact_hashes: F,
) -> JournalResult<(CompleteEvidence, RetainedOperationEvidence)>
where
    F: FnMut() -> JournalResult<()>,
{
    validate_and_retain_complete_operation_for(
        paths,
        CompleteRecordBinding::Committed(binding),
        between_artifact_hashes,
    )
}

fn validate_and_retain_complete_operation_for<F>(
    paths: &JournalPaths,
    binding: CompleteRecordBinding<'_>,
    mut between_artifact_hashes: F,
) -> JournalResult<(CompleteEvidence, RetainedOperationEvidence)>
where
    F: FnMut() -> JournalResult<()>,
{
    require_linux_durability()?;
    let verification_mode = binding.verification_mode();
    let artifacts_directory_code = match verification_mode {
        VerificationMode::Prepared => "RECOVERY_JOURNAL_CORRUPTION",
        VerificationMode::Committed => "RECOVERY_ARTIFACT_CORRUPTION",
    };
    let mut retained = RetainedOperationEvidence {
        verification_mode,
        directories: vec![
            open_retained_directory(
                &paths.operation_root,
                "operation root",
                "RECOVERY_JOURNAL_CORRUPTION",
                true,
                verification_mode,
            )?,
            open_retained_directory(
                &paths.recovery_root,
                "recovery root",
                "RECOVERY_JOURNAL_CORRUPTION",
                verification_mode == VerificationMode::Prepared,
                verification_mode,
            )?,
            open_retained_directory(
                &paths.operations,
                "operations root",
                "RECOVERY_JOURNAL_CORRUPTION",
                true,
                verification_mode,
            )?,
            open_retained_directory(
                &paths.operation,
                "operation directory",
                "RECOVERY_JOURNAL_CORRUPTION",
                false,
                verification_mode,
            )?,
            open_retained_directory(
                &paths.artifacts,
                "artifacts directory",
                artifacts_directory_code,
                false,
                verification_mode,
            )?,
            open_retained_directory(
                &paths.records,
                "records directory",
                "RECOVERY_JOURNAL_CORRUPTION",
                false,
                verification_mode,
            )?,
        ],
        files: Vec::new(),
        layouts: Vec::new(),
    };
    let recovery_entries = [OPERATIONS_DIRECTORY.into()];
    let operation_entries = ["artifacts".into(), "records".into()];
    let record_names = match verification_mode {
        VerificationMode::Prepared => {
            assert_exact_entries(
                &paths.recovery_root,
                &recovery_entries,
                "RECOVERY_JOURNAL_CORRUPTION",
            )?;
            assert_exact_entries(
                &paths.operation,
                &operation_entries,
                "RECOVERY_JOURNAL_CORRUPTION",
            )?;
            read_names(&paths.records)?
        }
        VerificationMode::Committed => {
            read_bounded_committed_layout(
                &paths.recovery_root,
                CommittedDirectoryRole::Recovery,
                CommittedLayoutExpectation::Exact(&recovery_entries),
            )?;
            read_bounded_committed_layout(
                &paths.operation,
                CommittedDirectoryRole::Operation,
                CommittedLayoutExpectation::Exact(&operation_entries),
            )?;
            read_bounded_committed_layout(
                &paths.records,
                CommittedDirectoryRole::Records,
                CommittedLayoutExpectation::Count(1),
            )?
        }
    };
    if record_names.len() != 1 {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "records directory must contain exactly one record",
        ));
    }
    let commitment_from_name = parse_record_name(&record_names[0]).ok_or_else(|| {
        JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "prepared record filename is malformed",
        )
    })?;
    let record_path = paths.records.join(&record_names[0]);
    retained.files.push(open_retained_file(
        &record_path,
        "prepared record",
        "RECOVERY_JOURNAL_CORRUPTION",
        MAX_RECORD_BYTES,
        true,
        None,
        None,
        verification_mode,
    )?);
    let bytes = read_retained_file(
        retained
            .files
            .last_mut()
            .expect("record evidence was pushed"),
        MAX_RECORD_BYTES,
        verification_mode,
    )?;
    if bytes.len() < 2 || bytes.last() != Some(&b'\n') || bytes[..bytes.len() - 1].ends_with(b"\n")
    {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "prepared record must have exactly one LF terminator",
        ));
    }
    let canonical = &bytes[..bytes.len() - 1];
    if canonical.contains(&b'\r') {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "prepared record has a noncanonical terminator",
        ));
    }
    let commitment_sha256 = record_hash(canonical);
    if commitment_sha256 != commitment_from_name {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "prepared record filename hash does not match",
        ));
    }
    if let CompleteRecordBinding::Committed(committed) = binding {
        if commitment_sha256 != committed.recovery_commitment.record_sha256 {
            return Err(JournalError::new(
                "RECOVERY_JOURNAL_CORRUPTION",
                "prepared record does not match the committed recovery hash",
            ));
        }
    }
    let record: PreparedRecord = serde_json::from_slice(canonical).map_err(|error| {
        JournalError::with_source(
            "RECOVERY_JOURNAL_CORRUPTION",
            format!("prepared record is malformed JSON: {error}"),
            error,
        )
    })?;
    match binding {
        CompleteRecordBinding::Prepared(prepared) => validate_record(&record, prepared, paths)?,
        CompleteRecordBinding::Committed(committed) => {
            validate_committed_record(&record, committed, paths)?
        }
    }
    if canonical_record_bytes(&record)? != canonical {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "prepared record bytes are noncanonical",
        ));
    }

    let expected_artifacts = ArtifactRole::all()
        .iter()
        .map(|role| artifact_filename(record.artifact(*role)))
        .collect::<JournalResult<Vec<_>>>()?;
    match verification_mode {
        VerificationMode::Prepared => {
            assert_exact_entries(
                &paths.artifacts,
                &expected_artifacts,
                "RECOVERY_ARTIFACT_CORRUPTION",
            )?;
            assert_no_sidecars(&paths.artifacts)?;
        }
        VerificationMode::Committed => {
            read_bounded_committed_layout(
                &paths.artifacts,
                CommittedDirectoryRole::Artifacts,
                CommittedLayoutExpectation::Exact(&expected_artifacts),
            )?;
        }
    }
    for role in ArtifactRole::all() {
        let artifact = record.artifact(role);
        retained.files.push(open_retained_file(
            &artifact_path(paths, &artifact.path)?,
            &format!("{} artifact", role.as_str()),
            "RECOVERY_ARTIFACT_CORRUPTION",
            MAX_ARTIFACT_BYTES,
            false,
            Some(role),
            Some(artifact.size_bytes),
            verification_mode,
        )?);
    }
    if matches!(binding, CompleteRecordBinding::Committed(_)) {
        assert_committed_retained_evidence_invariants(
            &retained,
            paths,
            &record_path,
            &expected_artifacts,
            &record,
        )?;
    }
    for index in 1..retained.files.len() {
        let opened = &mut retained.files[index];
        let role = opened.role.expect("artifact evidence has a role");
        let artifact = record.artifact(role);
        let (digest, size) = hash_open_artifact(
            &mut opened.file,
            &opened.path,
            &opened.snapshot.stable,
            role,
            opened.expected_size,
            verification_mode,
        )?;
        if digest != artifact.content_digest || size != artifact.size_bytes {
            return Err(JournalError::new(
                "RECOVERY_ARTIFACT_CORRUPTION",
                format!("{} artifact digest or size does not match", role.as_str()),
            ));
        }
        if index == 1 {
            between_artifact_hashes()?;
        }
    }
    if verification_mode == VerificationMode::Prepared {
        retained.layouts = vec![
            RetainedLayout {
                path: paths.recovery_root.clone(),
                expected: vec![OPERATIONS_DIRECTORY.into()],
                code: "RECOVERY_JOURNAL_CORRUPTION",
            },
            RetainedLayout {
                path: paths.operation.clone(),
                expected: vec!["artifacts".into(), "records".into()],
                code: "RECOVERY_JOURNAL_CORRUPTION",
            },
            RetainedLayout {
                path: paths.records.clone(),
                expected: record_names,
                code: "RECOVERY_JOURNAL_CORRUPTION",
            },
            RetainedLayout {
                path: paths.artifacts.clone(),
                expected: expected_artifacts,
                code: "RECOVERY_ARTIFACT_CORRUPTION",
            },
        ];
    }
    revalidate_retained_operation_evidence(&retained)?;
    Ok((
        CompleteEvidence {
            commitment_sha256,
            durability: platform_durability(),
        },
        retained,
    ))
}

fn assert_committed_retained_evidence_invariants(
    evidence: &RetainedOperationEvidence,
    paths: &JournalPaths,
    record_path: &Path,
    artifact_names: &[String],
    record: &PreparedRecord,
) -> JournalResult<()> {
    if evidence.verification_mode != VerificationMode::Committed
        || evidence.directories.len() != 6
        || evidence.files.len() != 3
        || !evidence.layouts.is_empty()
        || artifact_names.len() != 2
    {
        return Err(JournalError::new(
            "RECOVERY_EVIDENCE_TOKEN_INVALID",
            "committed recovery evidence must retain exactly nine handles",
        ));
    }
    let expected_directories = [
        (
            &paths.operation_root,
            "operation root",
            "RECOVERY_JOURNAL_CORRUPTION",
            true,
        ),
        (
            &paths.recovery_root,
            "recovery root",
            "RECOVERY_JOURNAL_CORRUPTION",
            false,
        ),
        (
            &paths.operations,
            "operations root",
            "RECOVERY_JOURNAL_CORRUPTION",
            true,
        ),
        (
            &paths.operation,
            "operation directory",
            "RECOVERY_JOURNAL_CORRUPTION",
            false,
        ),
        (
            &paths.artifacts,
            "artifacts directory",
            "RECOVERY_ARTIFACT_CORRUPTION",
            false,
        ),
        (
            &paths.records,
            "records directory",
            "RECOVERY_JOURNAL_CORRUPTION",
            false,
        ),
    ];
    for (retained, (path, label, code, mutable)) in evidence
        .directories
        .iter()
        .zip(expected_directories.into_iter())
    {
        if &retained.path != path
            || retained.label != label
            || retained.code != code
            || retained.mutable != mutable
        {
            return Err(JournalError::new(
                "RECOVERY_EVIDENCE_TOKEN_INVALID",
                "committed recovery directory evidence is incomplete or misbound",
            ));
        }
    }
    let expected_files = [
        (
            record_path.to_path_buf(),
            "prepared record",
            "RECOVERY_JOURNAL_CORRUPTION",
            None,
            None,
        ),
        (
            paths.artifacts.join(&artifact_names[0]),
            "candidate artifact",
            "RECOVERY_ARTIFACT_CORRUPTION",
            Some(ArtifactRole::Candidate),
            Some(record.candidate.size_bytes),
        ),
        (
            paths.artifacts.join(&artifact_names[1]),
            "rollback artifact",
            "RECOVERY_ARTIFACT_CORRUPTION",
            Some(ArtifactRole::Rollback),
            Some(record.rollback.size_bytes),
        ),
    ];
    for (retained, (path, label, code, role, expected_size)) in
        evidence.files.iter().zip(expected_files.into_iter())
    {
        if retained.path != path
            || retained.label != label
            || retained.code != code
            || retained.role != role
            || retained.expected_size != expected_size
            || expected_size.is_some_and(|size| retained.snapshot.size != size)
        {
            return Err(JournalError::new(
                "RECOVERY_EVIDENCE_TOKEN_INVALID",
                "committed recovery file evidence is incomplete or misbound",
            ));
        }
    }
    Ok(())
}

fn validate_record(
    record: &PreparedRecord,
    binding: &JournalIntentBinding,
    paths: &JournalPaths,
) -> JournalResult<()> {
    if record.protocol != PROTOCOL
        || record.protocol_version != PROTOCOL_VERSION
        || record.record_kind != PreparedMutationKind::PreparedMutation
        || record.sequence != 0
        || record.previous_record_sha256.is_some()
        || record.database_identity != DATABASE_IDENTITY
        || record.operation_id != binding.operation_id
        || record.operation != binding.operation
        || record.owner != binding.owner
        || record.fencing_generation != binding.fencing_generation
        || record.created_at != binding.intent_created_at
        || !is_lower_hex_64(&record.nonce)
    {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "prepared record binding is malformed",
        ));
    }
    if record.schema_contract != trusted_schema_identity()? {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "schema contract identity does not match trusted bytes",
        ));
    }
    record.checks.candidate.validate().map_err(|_| {
        JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "candidate recorded checks are malformed",
        )
    })?;
    record.checks.rollback.validate().map_err(|_| {
        JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "rollback recorded checks are malformed",
        )
    })?;
    for role in ArtifactRole::all() {
        let artifact = record.artifact(role);
        let key = artifact_key(&paths.operation_key, &record.nonce, role);
        let expected_path = format!("artifacts/{}-{key}.sqlite", role.as_str());
        if artifact.path != expected_path
            || !is_sha256_digest(&artifact.content_digest)
            || artifact.size_bytes > MAX_ARTIFACT_BYTES
        {
            return Err(JournalError::new(
                "RECOVERY_JOURNAL_CORRUPTION",
                format!("{} artifact record is malformed", role.as_str()),
            ));
        }
    }
    Ok(())
}

fn validate_committed_record(
    record: &PreparedRecord,
    binding: &CommittedRecoveryEvidenceBinding,
    paths: &JournalPaths,
) -> JournalResult<()> {
    if record.protocol != PROTOCOL
        || record.protocol_version != PROTOCOL_VERSION
        || record.record_kind != PreparedMutationKind::PreparedMutation
        || record.sequence != 0
        || record.previous_record_sha256.is_some()
        || !is_lower_hex_64(&record.nonce)
    {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "prepared record binding is malformed",
        ));
    }
    if !valid_identifier(&record.owner.owner_id)
        || !valid_identifier(&record.owner.host_id)
        || record.owner.process_id == 0
        || !valid_timestamp(&record.owner.process_started_at)
    {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "prepared record owner is malformed",
        ));
    }
    let expected_generation = record
        .fencing_generation
        .checked_add(binding.recovery_commitment.claim_sequence)
        .filter(|generation| *generation <= MAX_JSON_SAFE_INTEGER);
    if record.database_identity != DATABASE_IDENTITY
        || record.operation_id != binding.operation_id
        || record.operation != binding.operation
        || record.created_at != binding.created_at
        || record.fencing_generation == 0
        || expected_generation != Some(binding.fencing_generation)
        || (binding.recovery_commitment.claim_sequence == 0 && record.owner != binding.owner)
    {
        return Err(JournalError::new(
            "RECOVERY_LINEAGE_INVALID",
            "committed recovery evidence lineage does not match the immutable record",
        ));
    }
    if record.schema_contract != trusted_schema_identity()? {
        return Err(JournalError::new(
            "RECOVERY_VALIDATION_FAILED",
            "schema contract identity does not match trusted bytes",
        ));
    }
    record.checks.candidate.validate().map_err(|_| {
        JournalError::new(
            "RECOVERY_VALIDATION_FAILED",
            "candidate recorded checks are malformed",
        )
    })?;
    record.checks.rollback.validate().map_err(|_| {
        JournalError::new(
            "RECOVERY_VALIDATION_FAILED",
            "rollback recorded checks are malformed",
        )
    })?;
    for role in ArtifactRole::all() {
        let artifact = record.artifact(role);
        let key = artifact_key(&paths.operation_key, &record.nonce, role);
        let expected_path = format!("artifacts/{}-{key}.sqlite", role.as_str());
        if artifact.path != expected_path
            || !is_sha256_digest(&artifact.content_digest)
            || artifact.size_bytes > MAX_ARTIFACT_BYTES
        {
            return Err(JournalError::new(
                "RECOVERY_JOURNAL_CORRUPTION",
                format!("{} artifact record is malformed", role.as_str()),
            ));
        }
    }
    Ok(())
}

fn ensure_journal_parents(
    paths: &JournalPaths,
    root_identity: &DirectoryIdentity,
) -> JournalResult<Vec<DirectoryIdentity>> {
    let recovery_identity =
        ensure_private_directory(&paths.recovery_root, FaultPoint::AfterRecoveryRootCreate)?;
    revalidate_directory_identity(root_identity)?;
    let recovery_entries = read_names(&paths.recovery_root)?;
    if !recovery_entries.is_empty() && recovery_entries != [OPERATIONS_DIRECTORY.to_string()] {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "recovery root has unexpected entries",
        ));
    }
    let operations_identity = ensure_private_directory(
        &paths.operations,
        FaultPoint::AfterOperationsDirectoryCreate,
    )?;
    assert_exact_entries(
        &paths.recovery_root,
        &[OPERATIONS_DIRECTORY.into()],
        "RECOVERY_JOURNAL_CORRUPTION",
    )?;
    Ok(vec![recovery_identity, operations_identity])
}

fn validate_operation_root_argument(path: &Path) -> JournalResult<()> {
    let normalized = path.components().collect::<PathBuf>();
    let has_relative_component = path.components().any(|component| {
        matches!(
            component,
            std::path::Component::CurDir | std::path::Component::ParentDir
        )
    });
    let expected = sha256_hex(DATABASE_IDENTITY.as_bytes());
    if !path.is_absolute()
        || has_relative_component
        || !paths_equal(&normalized, path)
        || path.file_name() != Some(std::ffi::OsStr::new(&expected))
    {
        return Err(JournalError::new(
            "INVALID_RECOVERY_OPTIONS",
            "operation root must be an absolute canonical path for the fixed database identity",
        ));
    }
    Ok(())
}

fn validate_operation_root(path: &Path) -> JournalResult<DirectoryIdentity> {
    validate_operation_root_argument(path)?;
    let canonical = fs::canonicalize(path).map_err(|error| {
        JournalError::new(
            "INVALID_RECOVERY_OPTIONS",
            format!("operation root must exist: {error}"),
        )
    })?;
    if !paths_equal(&canonical, path) {
        return Err(JournalError::new(
            "INVALID_RECOVERY_OPTIONS",
            "operation root must be canonical and symlink-free",
        ));
    }
    inspect_private_directory(path, "operation root", "INVALID_RECOVERY_OPTIONS")
}

fn journal_paths(operation_root: &Path, binding: &JournalIntentBinding) -> JournalPaths {
    journal_paths_for(operation_root, &binding.operation_id)
}

fn journal_paths_for(operation_root: &Path, operation_id: &str) -> JournalPaths {
    let operation_key = operation_key(DATABASE_IDENTITY, operation_id);
    let recovery_root = operation_root.join(RECOVERY_DIRECTORY);
    let operations = recovery_root.join(OPERATIONS_DIRECTORY);
    let operation = operations.join(&operation_key);
    JournalPaths {
        operation_root: operation_root.to_path_buf(),
        recovery_root,
        operations,
        operation_key,
        artifacts: operation.join("artifacts"),
        records: operation.join("records"),
        operation,
    }
}

fn ensure_private_directory(path: &Path, fault: FaultPoint) -> JournalResult<DirectoryIdentity> {
    match create_directory_with_private_mode(path) {
        Ok(()) => {
            set_private_dir_mode(path)?;
            inject_fault(fault)?;
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(JournalError::filesystem("create journal directory", error)),
    }
    inspect_private_directory(path, "journal directory", "RECOVERY_JOURNAL_CORRUPTION")
}

fn create_private_directory(path: &Path, fault: FaultPoint) -> JournalResult<DirectoryIdentity> {
    match create_directory_with_private_mode(path) {
        Ok(()) => {
            set_private_dir_mode(path)?;
            inject_fault(fault)?;
            inspect_private_directory(path, "journal directory", "RECOVERY_JOURNAL_CORRUPTION")
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Err(JournalError::new(
            "RECOVERY_PREPARATION_INCOMPLETE",
            "operation path already exists",
        )),
        Err(error) => Err(JournalError::filesystem(
            "create operation directory",
            error,
        )),
    }
}

#[cfg(unix)]
fn create_directory_with_private_mode(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.mode(PRIVATE_DIR_MODE);
    builder.create(path)
}

#[cfg(not(unix))]
fn create_directory_with_private_mode(_path: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "atomic private directory creation is unsupported on this platform",
    ))
}

fn inspect_private_directory(
    path: &Path,
    label: &str,
    code: &'static str,
) -> JournalResult<DirectoryIdentity> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| JournalError::new(code, format!("inspect {label}: {error}")))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(JournalError::new(
            code,
            format!("{label} is not a non-symlink directory"),
        ));
    }
    #[cfg(unix)]
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err(JournalError::new(code, format!("{label} is not private")));
    }
    let canonical = fs::canonicalize(path)
        .map_err(|error| JournalError::new(code, format!("canonicalize {label}: {error}")))?;
    if !paths_equal(&canonical, path) {
        return Err(JournalError::new(
            code,
            format!("{label} is noncanonical or traverses a symlink"),
        ));
    }
    let info = inspect_path(path, true)
        .map_err(|error| JournalError::new(code, format!("inspect {label}: {error}")))?;
    if !info.is_directory || info.is_reparse || info.stable.second == 0 {
        return Err(JournalError::new(
            code,
            format!("{label} has no stable safe filesystem identity"),
        ));
    }
    Ok(DirectoryIdentity {
        path: path.to_path_buf(),
        stable: info.stable,
    })
}

fn revalidate_directory_identity(identity: &DirectoryIdentity) -> JournalResult<()> {
    let current = inspect_private_directory(
        &identity.path,
        "journal directory",
        "RECOVERY_JOURNAL_CORRUPTION",
    )?;
    if current.stable != identity.stable {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "journal directory identity changed",
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn open_retained_directory(
    path: &Path,
    label: &str,
    code: &'static str,
    mutable: bool,
    verification_mode: VerificationMode,
) -> JournalResult<RetainedDirectoryEvidence> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let file = options.open(path).map_err(|error| {
        verification_mode.retained_io_error(code, &format!("retain {label}"), error)
    })?;
    let open_metadata = file.metadata().map_err(|error| {
        verification_mode.retained_io_error(code, &format!("inspect retained {label}"), error)
    })?;
    let path_metadata = fs::symlink_metadata(path).map_err(|error| {
        verification_mode.retained_io_error(
            code,
            &format!("inspect retained path for {label}"),
            error,
        )
    })?;
    assert_retained_directory_metadata(&open_metadata, label, code)?;
    assert_retained_directory_metadata(&path_metadata, label, code)?;
    if path_metadata.file_type().is_symlink() {
        return Err(JournalError::new(code, format!("{label} is a symlink")));
    }
    let canonical = fs::canonicalize(path).map_err(|error| {
        verification_mode.retained_io_error(code, &format!("canonicalize {label}"), error)
    })?;
    if !paths_equal(&canonical, path) {
        return Err(JournalError::new(
            code,
            format!("{label} is noncanonical or traverses a symlink"),
        ));
    }
    let snapshot = retained_snapshot(&open_metadata, label)?;
    let path_snapshot = retained_snapshot(&path_metadata, label)?;
    if snapshot.stable != path_snapshot.stable || (!mutable && snapshot != path_snapshot) {
        return Err(JournalError::new(
            code,
            format!("{label} path identity changed"),
        ));
    }
    Ok(RetainedDirectoryEvidence {
        file,
        path: path.to_path_buf(),
        label: label.into(),
        code,
        mutable,
        snapshot,
    })
}

#[cfg(not(target_os = "linux"))]
fn open_retained_directory(
    _path: &Path,
    _label: &str,
    _code: &'static str,
    _mutable: bool,
    _verification_mode: VerificationMode,
) -> JournalResult<RetainedDirectoryEvidence> {
    Err(JournalError::new(
        "RECOVERY_DURABILITY_FAILURE",
        "retained Linux directory evidence is unavailable",
    ))
}

#[cfg(target_os = "linux")]
#[allow(clippy::too_many_arguments)]
fn open_retained_file(
    path: &Path,
    label: &str,
    code: &'static str,
    maximum_size: u64,
    require_nonempty: bool,
    role: Option<ArtifactRole>,
    expected_size: Option<u64>,
    verification_mode: VerificationMode,
) -> JournalResult<RetainedFileEvidence> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let file = options.open(path).map_err(|error| {
        verification_mode.retained_io_error(code, &format!("retain {label}"), error)
    })?;
    let open_metadata = file.metadata().map_err(|error| {
        verification_mode.retained_io_error(code, &format!("inspect retained {label}"), error)
    })?;
    let path_metadata = fs::symlink_metadata(path).map_err(|error| {
        verification_mode.retained_io_error(
            code,
            &format!("inspect retained path for {label}"),
            error,
        )
    })?;
    assert_retained_file_metadata(&open_metadata, label, code)?;
    assert_retained_file_metadata(&path_metadata, label, code)?;
    if path_metadata.file_type().is_symlink() {
        return Err(JournalError::new(code, format!("{label} is a symlink")));
    }
    let snapshot = retained_snapshot(&open_metadata, label)?;
    let path_snapshot = retained_snapshot(&path_metadata, label)?;
    if snapshot != path_snapshot {
        return Err(JournalError::new(
            code,
            format!("{label} path snapshot changed"),
        ));
    }
    if snapshot.size > maximum_size
        || (require_nonempty && snapshot.size == 0)
        || expected_size.is_some_and(|expected| expected != snapshot.size)
    {
        return Err(JournalError::new(
            code,
            format!("{label} has an invalid retained size"),
        ));
    }
    Ok(RetainedFileEvidence {
        file,
        path: path.to_path_buf(),
        label: label.into(),
        code,
        role,
        expected_size,
        snapshot,
    })
}

#[cfg(not(target_os = "linux"))]
#[allow(clippy::too_many_arguments)]
fn open_retained_file(
    _path: &Path,
    _label: &str,
    _code: &'static str,
    _maximum_size: u64,
    _require_nonempty: bool,
    _role: Option<ArtifactRole>,
    _expected_size: Option<u64>,
    _verification_mode: VerificationMode,
) -> JournalResult<RetainedFileEvidence> {
    Err(JournalError::new(
        "RECOVERY_DURABILITY_FAILURE",
        "retained Linux file evidence is unavailable",
    ))
}

#[cfg(target_os = "linux")]
fn retained_snapshot(metadata: &fs::Metadata, label: &str) -> JournalResult<RetainedStatSnapshot> {
    if metadata.ino() == 0
        || metadata.nlink() == 0
        || !(0..1_000_000_000).contains(&metadata.mtime_nsec())
        || !(0..1_000_000_000).contains(&metadata.ctime_nsec())
    {
        return Err(JournalError::new(
            "RECOVERY_DURABILITY_FAILURE",
            format!("stable nanosecond filesystem evidence is unavailable for {label}"),
        ));
    }
    Ok(RetainedStatSnapshot {
        stable: StableIdentity {
            first: metadata.dev(),
            second: metadata.ino(),
        },
        links: metadata.nlink(),
        mode: metadata.mode() & 0o777,
        size: metadata.size(),
        modified_seconds: metadata.mtime(),
        modified_nanoseconds: metadata.mtime_nsec(),
        changed_seconds: metadata.ctime(),
        changed_nanoseconds: metadata.ctime_nsec(),
    })
}

#[cfg(not(target_os = "linux"))]
fn retained_snapshot(_metadata: &fs::Metadata, label: &str) -> JournalResult<RetainedStatSnapshot> {
    Err(JournalError::new(
        "RECOVERY_DURABILITY_FAILURE",
        format!("stable nanosecond filesystem evidence is unavailable for {label}"),
    ))
}

#[cfg(target_os = "linux")]
fn assert_retained_directory_metadata(
    metadata: &fs::Metadata,
    label: &str,
    code: &'static str,
) -> JournalResult<()> {
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(JournalError::new(
            code,
            format!("{label} is not a retained directory"),
        ));
    }
    let snapshot = retained_snapshot(metadata, label)?;
    if snapshot.mode & 0o077 != 0 {
        return Err(JournalError::new(code, format!("{label} is not private")));
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn assert_retained_directory_metadata(
    _metadata: &fs::Metadata,
    _label: &str,
    _code: &'static str,
) -> JournalResult<()> {
    Err(JournalError::new(
        "RECOVERY_DURABILITY_FAILURE",
        "retained Linux directory evidence is unavailable",
    ))
}

#[cfg(target_os = "linux")]
fn assert_retained_file_metadata(
    metadata: &fs::Metadata,
    label: &str,
    code: &'static str,
) -> JournalResult<()> {
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(JournalError::new(
            code,
            format!("{label} is not a retained regular file"),
        ));
    }
    let snapshot = retained_snapshot(metadata, label)?;
    if snapshot.links != 1 || snapshot.mode != PRIVATE_READ_ONLY_FILE_MODE {
        return Err(JournalError::new(
            code,
            format!("{label} is linked or is not sealed read-only"),
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn assert_retained_file_metadata(
    _metadata: &fs::Metadata,
    _label: &str,
    _code: &'static str,
) -> JournalResult<()> {
    Err(JournalError::new(
        "RECOVERY_DURABILITY_FAILURE",
        "retained Linux file evidence is unavailable",
    ))
}

fn revalidate_retained_operation_evidence(
    retained: &RetainedOperationEvidence,
) -> JournalResult<()> {
    let mut reopened_directories = Vec::with_capacity(retained.directories.len());
    for evidence in &retained.directories {
        let current = open_retained_directory(
            &evidence.path,
            &evidence.label,
            evidence.code,
            evidence.mutable,
            retained.verification_mode,
        )?;
        if current.snapshot.stable != evidence.snapshot.stable
            || (retained.verification_mode == VerificationMode::Prepared
                && !evidence.mutable
                && current.snapshot != evidence.snapshot)
        {
            return Err(JournalError::new(
                evidence.code,
                format!("{} retained evidence changed", evidence.label),
            ));
        }
        reopened_directories.push(current);
    }
    let mut reopened_files = Vec::with_capacity(retained.files.len());
    for evidence in &retained.files {
        let current = open_retained_file(
            &evidence.path,
            &evidence.label,
            evidence.code,
            evidence.snapshot.size,
            evidence.snapshot.size > 0,
            evidence.role,
            evidence.expected_size,
            retained.verification_mode,
        )?;
        if current.snapshot != evidence.snapshot {
            return Err(JournalError::new(
                evidence.code,
                format!("{} retained evidence changed", evidence.label),
            ));
        }
        reopened_files.push(current);
    }
    for layout in &retained.layouts {
        assert_bounded_exact_entries(&layout.path, &layout.expected, layout.code)?;
    }
    for (evidence, current) in retained.directories.iter().zip(&reopened_directories) {
        if !evidence.mutable && current.snapshot != evidence.snapshot {
            return Err(JournalError::new(
                evidence.code,
                format!("{} retained evidence changed", evidence.label),
            ));
        }
    }
    for evidence in &retained.directories {
        let metadata = evidence.file.metadata().map_err(|error| {
            retained.verification_mode.retained_io_error(
                evidence.code,
                &format!("restat retained {}", evidence.label),
                error,
            )
        })?;
        assert_retained_directory_metadata(&metadata, &evidence.label, evidence.code)?;
        let snapshot = retained_snapshot(&metadata, &evidence.label)?;
        if snapshot.stable != evidence.snapshot.stable
            || (!evidence.mutable && snapshot != evidence.snapshot)
        {
            return Err(JournalError::new(
                evidence.code,
                format!("{} retained handle changed", evidence.label),
            ));
        }
    }
    for evidence in &retained.files {
        let metadata = evidence.file.metadata().map_err(|error| {
            retained.verification_mode.retained_io_error(
                evidence.code,
                &format!("restat retained {}", evidence.label),
                error,
            )
        })?;
        assert_retained_file_metadata(&metadata, &evidence.label, evidence.code)?;
        if retained_snapshot(&metadata, &evidence.label)? != evidence.snapshot {
            return Err(JournalError::new(
                evidence.code,
                format!("{} retained handle changed", evidence.label),
            ));
        }
    }
    drop(reopened_files);
    drop(reopened_directories);
    Ok(())
}

#[derive(Clone, Copy)]
enum CommittedDirectoryRole {
    Recovery,
    Operation,
    Records,
    Artifacts,
}

impl CommittedDirectoryRole {
    fn label(self) -> &'static str {
        match self {
            Self::Recovery => "recovery",
            Self::Operation => "operation",
            Self::Records => "records",
            Self::Artifacts => "artifacts",
        }
    }

    fn corruption_code(self) -> &'static str {
        match self {
            Self::Artifacts => "RECOVERY_ARTIFACT_CORRUPTION",
            Self::Recovery | Self::Operation | Self::Records => "RECOVERY_JOURNAL_CORRUPTION",
        }
    }
}

#[derive(Clone, Copy)]
enum CommittedLayoutExpectation<'a> {
    Exact(&'a [String]),
    Count(usize),
}

impl CommittedLayoutExpectation<'_> {
    fn expected_count(self) -> usize {
        match self {
            Self::Exact(expected) => expected.len(),
            Self::Count(expected) => expected,
        }
    }
}

fn read_bounded_committed_layout(
    path: &Path,
    role: CommittedDirectoryRole,
    expectation: CommittedLayoutExpectation<'_>,
) -> JournalResult<Vec<String>> {
    let mut directory = fs::read_dir(path).map_err(|error| {
        JournalError::filesystem(&format!("read committed {} layout", role.label()), error)
    })?;
    let mut actual = Vec::with_capacity(expectation.expected_count() + 1);
    for _ in 0..=expectation.expected_count() {
        let Some(entry) = directory.next() else {
            break;
        };
        #[cfg(test)]
        COMMITTED_LAYOUT_ENTRY_READS.with(|count| count.set(count.get() + 1));
        let entry = entry.map_err(|error| {
            JournalError::filesystem(
                &format!("read committed {} layout entry", role.label()),
                error,
            )
        })?;
        let name = entry.file_name().into_string().map_err(|_| {
            JournalError::new(
                role.corruption_code(),
                format!("committed {} entry name is not valid Unicode", role.label()),
            )
        })?;
        actual.push(name);
    }

    let matches = match expectation {
        CommittedLayoutExpectation::Exact(expected) => {
            actual.sort();
            let mut expected = expected.to_vec();
            expected.sort();
            actual == expected
        }
        CommittedLayoutExpectation::Count(expected) => actual.len() == expected,
    };
    if !matches {
        return Err(JournalError::new(
            role.corruption_code(),
            format!("committed {} layout changed", role.label()),
        ));
    }
    Ok(actual)
}

fn assert_bounded_exact_entries(
    path: &Path,
    expected: &[String],
    code: &'static str,
) -> JournalResult<()> {
    let mut actual = fs::read_dir(path)
        .map_err(|error| JournalError::filesystem("read retained layout", error))?
        .take(expected.len() + 1)
        .map(|entry| {
            entry
                .map_err(|error| JournalError::filesystem("read retained entry", error))?
                .file_name()
                .into_string()
                .map_err(|_| JournalError::new(code, "retained entry name is not valid Unicode"))
        })
        .collect::<JournalResult<Vec<_>>>()?;
    actual.sort();
    let mut expected = expected.to_vec();
    expected.sort();
    if actual != expected {
        return Err(JournalError::new(code, "retained journal layout changed"));
    }
    Ok(())
}

fn read_retained_file(
    evidence: &mut RetainedFileEvidence,
    maximum_size: u64,
    verification_mode: VerificationMode,
) -> JournalResult<Vec<u8>> {
    if evidence.snapshot.size == 0 || evidence.snapshot.size > maximum_size {
        return Err(JournalError::new(
            evidence.code,
            format!("{} has an invalid size", evidence.label),
        ));
    }
    evidence
        .file
        .seek(SeekFrom::Start(0))
        .map_err(|error| JournalError::filesystem("seek retained file", error))?;
    let mut bytes = vec![0u8; evidence.snapshot.size as usize];
    evidence.file.read_exact(&mut bytes).map_err(|error| {
        verification_mode.retained_io_error(
            evidence.code,
            &format!("read retained {}", evidence.label),
            error,
        )
    })?;
    let mut extra = [0u8; 1];
    if evidence.file.read(&mut extra).map_err(|error| {
        verification_mode.retained_io_error(
            evidence.code,
            &format!("finish retained {} read", evidence.label),
            error,
        )
    })? != 0
    {
        return Err(JournalError::new(
            evidence.code,
            format!("{} grew while reading", evidence.label),
        ));
    }
    let metadata = evidence.file.metadata().map_err(|error| {
        verification_mode.retained_io_error(
            evidence.code,
            &format!("restat retained {}", evidence.label),
            error,
        )
    })?;
    assert_retained_file_metadata(&metadata, &evidence.label, evidence.code)?;
    if retained_snapshot(&metadata, &evidence.label)? != evidence.snapshot {
        return Err(JournalError::new(
            evidence.code,
            format!("{} changed while reading", evidence.label),
        ));
    }
    Ok(bytes)
}

fn set_private_dir_mode(_path: &Path) -> JournalResult<()> {
    #[cfg(unix)]
    fs::set_permissions(_path, fs::Permissions::from_mode(PRIVATE_DIR_MODE))
        .map_err(|error| JournalError::filesystem("set private directory mode", error))?;
    Ok(())
}

fn open_exclusive_file(path: &Path) -> JournalResult<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        options
            .mode(PRIVATE_WRITABLE_FILE_MODE)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return Err(JournalError::new(
                "RECOVERY_JOURNAL_CORRUPTION",
                "final journal path already exists",
            ));
        }
        Err(error) => return Err(JournalError::filesystem("create journal file", error)),
    };
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(PRIVATE_WRITABLE_FILE_MODE))
        .map_err(|error| JournalError::filesystem("set private file mode", error))?;
    Ok(file)
}

fn set_no_follow(options: &mut OpenOptions) {
    #[cfg(unix)]
    {
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
}

fn inspect_open_regular_file(
    file: &File,
    path: &Path,
    label: &str,
    code: &'static str,
    preserve_filesystem_failure: bool,
) -> JournalResult<StableIdentity> {
    let classify = |action: &str, error| {
        if preserve_filesystem_failure {
            JournalError::filesystem(action, error)
        } else {
            JournalError::new(code, format!("{action}: {error}"))
        }
    };
    let open =
        inspect_file(file).map_err(|error| classify(&format!("inspect open {label}"), error))?;
    let current =
        inspect_path(path, false).map_err(|error| classify(&format!("inspect {label}"), error))?;
    if !open.is_file
        || !current.is_file
        || open.is_reparse
        || current.is_reparse
        || open.links != 1
        || current.links != 1
        || open.stable.second == 0
        || open.stable != current.stable
    {
        return Err(JournalError::new(
            code,
            format!("{label} is replaced, linked, reparse-backed, or not a stable regular file"),
        ));
    }
    #[cfg(unix)]
    {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| classify(&format!("inspect {label}"), error))?;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(JournalError::new(code, format!("{label} is not private")));
        }
    }
    Ok(open.stable)
}

fn revalidate_open_regular_file(
    file: &File,
    path: &Path,
    identity: &StableIdentity,
    label: &str,
    code: &'static str,
    preserve_filesystem_failure: bool,
) -> JournalResult<()> {
    if &inspect_open_regular_file(file, path, label, code, preserve_filesystem_failure)? != identity
    {
        return Err(JournalError::new(code, format!("{label} identity changed")));
    }
    Ok(())
}

fn revalidate_open_sealed_file(
    file: &File,
    path: &Path,
    identity: &StableIdentity,
    label: &str,
    code: &'static str,
    preserve_filesystem_failure: bool,
) -> JournalResult<()> {
    revalidate_open_regular_file(
        file,
        path,
        identity,
        label,
        code,
        preserve_filesystem_failure,
    )?;
    #[cfg(unix)]
    {
        let mode = fs::symlink_metadata(path)
            .map_err(|error| {
                if preserve_filesystem_failure {
                    JournalError::filesystem(&format!("inspect {label}"), error)
                } else {
                    JournalError::new(code, format!("inspect {label}: {error}"))
                }
            })?
            .permissions()
            .mode()
            & 0o777;
        if mode != PRIVATE_READ_ONLY_FILE_MODE {
            return Err(JournalError::new(
                code,
                format!("{label} is not sealed read-only"),
            ));
        }
    }
    Ok(())
}

fn flush_and_seal_file(
    file: &File,
    path: &Path,
    identity: &StableIdentity,
    label: &str,
    code: &'static str,
) -> JournalResult<()> {
    file.sync_all()
        .map_err(|error| JournalError::durability(&format!("flush {label}"), error))?;
    #[cfg(unix)]
    file.set_permissions(fs::Permissions::from_mode(PRIVATE_READ_ONLY_FILE_MODE))
        .map_err(|error| JournalError::durability(&format!("seal {label}"), error))?;
    file.sync_all()
        .map_err(|error| JournalError::durability(&format!("flush sealed {label}"), error))?;
    revalidate_open_sealed_file(file, path, identity, label, code, false)
}

fn hash_open_artifact(
    file: &mut File,
    path: &Path,
    identity: &StableIdentity,
    role: ArtifactRole,
    expected_size: Option<u64>,
    verification_mode: VerificationMode,
) -> JournalResult<(String, u64)> {
    let size = file
        .metadata()
        .map_err(|error| JournalError::filesystem("stat artifact", error))?
        .len();
    if size > MAX_ARTIFACT_BYTES || expected_size.is_some_and(|expected| size != expected) {
        return Err(JournalError::new(
            "RECOVERY_ARTIFACT_CORRUPTION",
            "artifact opened size is unexpected or exceeds the 8 GiB limit",
        ));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| JournalError::filesystem("seek artifact", error))?;
    let mut hasher = artifact_hasher(role);
    let mut buffer = vec![0u8; HASH_CHUNK_SIZE];
    let mut total = 0u64;
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| JournalError::filesystem("hash artifact", error))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        total += count as u64;
        if total > size {
            return Err(JournalError::new(
                "RECOVERY_ARTIFACT_CORRUPTION",
                "artifact grew while hashing",
            ));
        }
    }
    if total != size {
        return Err(JournalError::new(
            "RECOVERY_ARTIFACT_CORRUPTION",
            "artifact changed while hashing",
        ));
    }
    revalidate_open_sealed_file(
        file,
        path,
        identity,
        "artifact",
        "RECOVERY_ARTIFACT_CORRUPTION",
        verification_mode.preserves_filesystem_failure(),
    )?;
    let final_size = file
        .metadata()
        .map_err(|error| JournalError::filesystem("restat artifact", error))?
        .len();
    if final_size != size {
        return Err(JournalError::new(
            "RECOVERY_ARTIFACT_CORRUPTION",
            "artifact size changed while hashing",
        ));
    }
    Ok((format!("sha256:{}", hex(&hasher.finalize())), size))
}

fn open_artifact_evidence(
    path: &Path,
    role: ArtifactRole,
    expected_size: u64,
) -> JournalResult<OpenArtifactEvidence> {
    let mut options = OpenOptions::new();
    options.read(true);
    set_no_follow(&mut options);
    let file = options.open(path).map_err(|error| {
        JournalError::new(
            "RECOVERY_ARTIFACT_CORRUPTION",
            format!("open artifact: {error}"),
        )
    })?;
    let identity = inspect_open_regular_file(
        &file,
        path,
        "artifact",
        "RECOVERY_ARTIFACT_CORRUPTION",
        false,
    )?;
    revalidate_open_sealed_file(
        &file,
        path,
        &identity,
        "artifact",
        "RECOVERY_ARTIFACT_CORRUPTION",
        false,
    )?;
    let snapshot = artifact_snapshot(&file)?;
    if snapshot.size > MAX_ARTIFACT_BYTES || snapshot.size != expected_size {
        return Err(JournalError::new(
            "RECOVERY_ARTIFACT_CORRUPTION",
            "artifact opened size is unexpected or exceeds the 8 GiB limit",
        ));
    }
    Ok(OpenArtifactEvidence {
        file,
        path: path.to_path_buf(),
        identity,
        snapshot,
        role,
        expected_size,
    })
}

fn artifact_snapshot(file: &File) -> JournalResult<ArtifactSnapshot> {
    let metadata = file
        .metadata()
        .map_err(|error| JournalError::filesystem("snapshot artifact", error))?;
    Ok(ArtifactSnapshot {
        size: metadata.len(),
        #[cfg(target_os = "linux")]
        modified_seconds: metadata.mtime(),
        #[cfg(target_os = "linux")]
        modified_nanoseconds: metadata.mtime_nsec(),
        #[cfg(target_os = "linux")]
        changed_seconds: metadata.ctime(),
        #[cfg(target_os = "linux")]
        changed_nanoseconds: metadata.ctime_nsec(),
    })
}

fn revalidate_artifact_evidence(evidence: &OpenArtifactEvidence) -> JournalResult<()> {
    revalidate_open_sealed_file(
        &evidence.file,
        &evidence.path,
        &evidence.identity,
        "artifact",
        "RECOVERY_ARTIFACT_CORRUPTION",
        false,
    )?;
    if artifact_snapshot(&evidence.file)? != evidence.snapshot {
        return Err(JournalError::new(
            "RECOVERY_ARTIFACT_CORRUPTION",
            format!(
                "{} artifact changed during complete evidence verification",
                evidence.role.as_str()
            ),
        ));
    }
    Ok(())
}

fn read_secure_file(
    path: &Path,
    maximum: u64,
    label: &str,
    code: &'static str,
) -> JournalResult<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true);
    set_no_follow(&mut options);
    let mut file = options
        .open(path)
        .map_err(|error| JournalError::new(code, format!("open {label}: {error}")))?;
    let identity = inspect_open_regular_file(&file, path, label, code, false)?;
    revalidate_open_sealed_file(&file, path, &identity, label, code, false)?;
    let size = file
        .metadata()
        .map_err(|error| JournalError::new(code, format!("stat {label}: {error}")))?
        .len();
    if size == 0 || size > maximum {
        return Err(JournalError::new(code, format!("{label} has invalid size")));
    }
    let mut bytes = vec![0u8; size as usize];
    file.read_exact(&mut bytes)
        .map_err(|error| JournalError::new(code, format!("read {label}: {error}")))?;
    let mut extra = [0u8; 1];
    if file
        .read(&mut extra)
        .map_err(|error| JournalError::new(code, format!("finish reading {label}: {error}")))?
        != 0
    {
        return Err(JournalError::new(
            code,
            format!("{label} grew while reading"),
        ));
    }
    revalidate_open_sealed_file(&file, path, &identity, label, code, false)?;
    Ok(bytes)
}

fn finish_durability(paths: &JournalPaths) -> JournalResult<JournalDurability> {
    require_linux_durability()?;
    for (path, fault) in [
        (&paths.artifacts, FaultPoint::AfterArtifactsDirectoryFsync),
        (&paths.records, FaultPoint::AfterRecordsDirectoryFsync),
        (&paths.operation, FaultPoint::AfterOperationDirectoryFsync),
        (&paths.operations, FaultPoint::AfterOperationsDirectoryFsync),
        (&paths.recovery_root, FaultPoint::AfterRecoveryRootFsync),
        (&paths.operation_root, FaultPoint::AfterOperationRootFsync),
    ] {
        sync_directory(path)?;
        inject_fault(fault)?;
    }
    Ok(JournalDurability::LinuxFsyncComplete)
}

fn sync_directory(path: &Path) -> JournalResult<()> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| JournalError::durability("fsync journal directory", error))
}

fn platform_durability() -> JournalDurability {
    JournalDurability::LinuxFsyncComplete
}

fn require_linux_durability() -> JournalResult<()> {
    if cfg!(target_os = "linux") {
        Ok(())
    } else {
        Err(JournalError::new(
            "RECOVERY_DURABILITY_FAILURE",
            "recovery journal proof issuance and verification require Linux fsync semantics",
        ))
    }
}

fn trusted_schema_identity() -> JournalResult<SchemaContractIdentity> {
    let contract: JsonValue = serde_json::from_slice(SCHEMA_CONTRACT_BYTES).map_err(|error| {
        JournalError::new(
            "RECOVERY_VALIDATION_FAILED",
            format!("trusted schema contract is malformed: {error}"),
        )
    })?;
    let object = contract.as_object().ok_or_else(|| {
        JournalError::new(
            "RECOVERY_VALIDATION_FAILED",
            "trusted schema contract is not an object",
        )
    })?;
    let version = object.get("contractVersion").and_then(JsonValue::as_u64);
    let latest = object.get("latestMigration").and_then(JsonValue::as_str);
    if version != Some(EXPECTED_SCHEMA_CONTRACT_VERSION)
        || latest != Some(EXPECTED_LATEST_MIGRATION)
    {
        return Err(JournalError::new(
            "RECOVERY_VALIDATION_FAILED",
            "trusted schema contract version or latest migration drifted",
        ));
    }
    Ok(SchemaContractIdentity {
        raw_bytes_sha256: format!("sha256:{}", sha256_hex(SCHEMA_CONTRACT_BYTES)),
        contract_version: EXPECTED_SCHEMA_CONTRACT_VERSION,
        latest_migration: EXPECTED_LATEST_MIGRATION.into(),
    })
}

fn canonical_record_bytes(record: &PreparedRecord) -> JournalResult<Vec<u8>> {
    let value = serde_json::to_value(record).map_err(|error| {
        JournalError::new(
            "RECOVERY_VALIDATION_FAILED",
            format!("serialize prepared record: {error}"),
        )
    })?;
    canonical_json_bytes(&value)
}

fn canonical_json_bytes(value: &JsonValue) -> JournalResult<Vec<u8>> {
    let mut output = String::new();
    write_canonical_value(value, &mut output)?;
    Ok(output.into_bytes())
}

fn write_canonical_value(value: &JsonValue, output: &mut String) -> JournalResult<()> {
    match value {
        JsonValue::Null => output.push_str("null"),
        JsonValue::Bool(true) => output.push_str("true"),
        JsonValue::Bool(false) => output.push_str("false"),
        JsonValue::String(string) => write_canonical_string(string, output),
        JsonValue::Number(number) => {
            let integer = canonical_safe_integer(number).ok_or_else(|| {
                JournalError::new(
                    "RECOVERY_VALIDATION_FAILED",
                    "canonical numbers must be non-negative safe integers",
                )
            })?;
            output.push_str(&integer.to_string());
        }
        JsonValue::Array(values) => {
            output.push('[');
            for (index, item) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_canonical_value(item, output)?;
            }
            output.push(']');
        }
        JsonValue::Object(object) => {
            output.push('{');
            let mut entries = object.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.as_bytes().cmp(right.as_bytes()));
            for (index, (key, item)) in entries.into_iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_canonical_string(key, output);
                output.push(':');
                write_canonical_value(item, output)?;
            }
            output.push('}');
        }
    }
    Ok(())
}

fn write_canonical_string(value: &str, output: &mut String) {
    output.push('"');
    for character in value.chars() {
        match character {
            '\u{0008}' => output.push_str("\\b"),
            '\u{0009}' => output.push_str("\\t"),
            '\u{000a}' => output.push_str("\\n"),
            '\u{000c}' => output.push_str("\\f"),
            '\u{000d}' => output.push_str("\\r"),
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            character if character <= '\u{001f}' => {
                output.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => output.push(character),
        }
    }
    output.push('"');
}

fn operation_key(database_identity: &str, operation_id: &str) -> String {
    hash_parts(&[
        OPERATION_KEY_DOMAIN,
        database_identity.as_bytes(),
        b"\0",
        operation_id.as_bytes(),
    ])
}

fn artifact_key(operation_key: &str, nonce: &str, role: ArtifactRole) -> String {
    hash_parts(&[
        ARTIFACT_KEY_DOMAIN,
        operation_key.as_bytes(),
        b"\0",
        nonce.as_bytes(),
        b"\0",
        role.as_str().as_bytes(),
    ])
}

fn artifact_hasher(role: ArtifactRole) -> Sha256 {
    let mut hasher = Sha256::new();
    hasher.update(ARTIFACT_CONTENT_DOMAIN);
    hasher.update(role.as_str().as_bytes());
    hasher.update(b"\0");
    hasher
}

fn artifact_digest(role: ArtifactRole, bytes: &[u8]) -> String {
    let mut hasher = artifact_hasher(role);
    hasher.update(bytes);
    format!("sha256:{}", hex(&hasher.finalize()))
}

fn record_hash(canonical: &[u8]) -> String {
    hash_parts(&[RECORD_DOMAIN, canonical])
}

fn hash_parts(parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hex(&hasher.finalize())
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

fn artifact_path(paths: &JournalPaths, relative: &str) -> JournalResult<PathBuf> {
    let (directory, filename) = relative.split_once('/').ok_or_else(|| {
        JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "artifact path is not a fixed relative path",
        )
    })?;
    if directory != "artifacts" || filename.contains('/') || filename.contains('\\') {
        return Err(JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            "artifact path escapes its fixed directory",
        ));
    }
    Ok(paths.artifacts.join(filename))
}

fn artifact_filename(artifact: &ArtifactRecord) -> JournalResult<String> {
    artifact
        .path
        .strip_prefix("artifacts/")
        .filter(|name| !name.contains('/') && !name.contains('\\'))
        .map(str::to_owned)
        .ok_or_else(|| {
            JournalError::new("RECOVERY_JOURNAL_CORRUPTION", "artifact path is malformed")
        })
}

fn parse_record_name(name: &str) -> Option<String> {
    let hash = name
        .strip_prefix("00000000000000000000-")?
        .strip_suffix(".json")?;
    is_lower_hex_64(hash).then(|| hash.to_owned())
}

fn assert_exact_entries(path: &Path, expected: &[String], code: &'static str) -> JournalResult<()> {
    let actual = read_names(path)?.into_iter().collect::<BTreeSet<_>>();
    let expected = expected.iter().cloned().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(JournalError::new(
            code,
            "journal directory contains missing or unexpected entries",
        ));
    }
    Ok(())
}

fn assert_no_sidecars(path: &Path) -> JournalResult<()> {
    if read_names(path)?.iter().any(|name| {
        name.ends_with(".sqlite-wal")
            || name.ends_with(".sqlite-shm")
            || name.ends_with(".sqlite-journal")
    }) {
        return Err(JournalError::new(
            "RECOVERY_ARTIFACT_CORRUPTION",
            "SQLite sidecars are forbidden",
        ));
    }
    Ok(())
}

fn read_names(path: &Path) -> JournalResult<Vec<String>> {
    fs::read_dir(path)
        .map_err(|error| JournalError::filesystem("read journal directory", error))?
        .map(|entry| {
            let entry =
                entry.map_err(|error| JournalError::filesystem("read journal entry", error))?;
            entry.file_name().into_string().map_err(|_| {
                JournalError::new(
                    "RECOVERY_JOURNAL_CORRUPTION",
                    "journal entry name is not valid Unicode",
                )
            })
        })
        .collect()
}

fn path_exists(path: &Path) -> JournalResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(JournalError::filesystem("inspect operation path", error)),
    }
}

#[cfg(unix)]
fn paths_equal(left: &Path, right: &Path) -> bool {
    left.as_os_str().as_bytes() == right.as_os_str().as_bytes()
}

#[cfg(windows)]
fn paths_equal(left: &Path, right: &Path) -> bool {
    fn normalized(path: &Path) -> Vec<u16> {
        let mut value = path.as_os_str().encode_wide().collect::<Vec<_>>();
        if value.starts_with(&[b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16]) {
            value.drain(..4);
        }
        value
            .into_iter()
            .map(|unit| {
                if (b'A' as u16..=b'Z' as u16).contains(&unit) {
                    unit + 32
                } else {
                    unit
                }
            })
            .collect()
    }
    normalized(left) == normalized(right)
}

fn valid_identifier(value: &str) -> bool {
    (1..=128).contains(&value.chars().count())
}

fn valid_timestamp(value: &str) -> bool {
    const FORMAT: &[time::format_description::FormatItem<'static>] =
        format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]");
    if value.len() != 24
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
        || value.as_bytes().get(10) != Some(&b'T')
        || value.as_bytes().get(13) != Some(&b':')
        || value.as_bytes().get(16) != Some(&b':')
        || value.as_bytes().get(19) != Some(&b'.')
        || !value.ends_with('Z')
    {
        return false;
    }
    let Ok(timestamp) = time::PrimitiveDateTime::parse(&value[..value.len() - 1], FORMAT) else {
        return false;
    };
    timestamp
        .format(FORMAT)
        .is_ok_and(|round_trip| round_trip == value[..value.len() - 1])
}

fn normalize_intent_metadata_value(value: &JsonValue) -> JournalResult<JsonValue> {
    match value {
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::String(_) => Ok(value.clone()),
        JsonValue::Number(number) => canonical_safe_integer(number)
            .map(serde_json::Number::from)
            .map(JsonValue::Number)
            .ok_or_else(|| {
                JournalError::new(
                    "INVALID_RECOVERY_OPTIONS",
                    "intent metadata numbers must be non-negative safe integers",
                )
            }),
        JsonValue::Array(values) => values
            .iter()
            .map(normalize_intent_metadata_value)
            .collect::<JournalResult<Vec<_>>>()
            .map(JsonValue::Array),
        JsonValue::Object(object) => object
            .iter()
            .map(|(key, item)| {
                normalize_intent_metadata_value(item).map(|value| (key.clone(), value))
            })
            .collect::<JournalResult<serde_json::Map<_, _>>>()
            .map(JsonValue::Object),
    }
}

pub(crate) fn canonical_safe_integer(number: &serde_json::Number) -> Option<u64> {
    if let Some(integer) = number.as_u64() {
        return (integer <= MAX_JSON_SAFE_INTEGER).then_some(integer);
    }
    let float = number.as_f64()?;
    if !float.is_finite()
        || float < 0.0
        || (float == 0.0 && float.is_sign_negative())
        || float.fract() != 0.0
        || float > MAX_JSON_SAFE_INTEGER as f64
    {
        return None;
    }
    Some(float as u64)
}

fn valid_intent_metadata(value: &Option<JsonValue>) -> bool {
    match value {
        None => true,
        Some(metadata) => metadata.is_object() && canonical_json_bytes(metadata).is_ok(),
    }
}

fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_sha256_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(is_lower_hex_64)
}

#[cfg(unix)]
fn inspect_file(file: &File) -> io::Result<FileInspection> {
    let metadata = file.metadata()?;
    Ok(FileInspection {
        stable: StableIdentity {
            first: metadata.dev(),
            second: metadata.ino(),
        },
        links: metadata.nlink(),
        is_file: metadata.is_file(),
        is_directory: metadata.is_dir(),
        is_reparse: false,
    })
}

#[cfg(unix)]
fn inspect_path(path: &Path, _directory: bool) -> io::Result<FileInspection> {
    let metadata = fs::symlink_metadata(path)?;
    Ok(FileInspection {
        stable: StableIdentity {
            first: metadata.dev(),
            second: metadata.ino(),
        },
        links: metadata.nlink(),
        is_file: metadata.is_file() && !metadata.file_type().is_symlink(),
        is_directory: metadata.is_dir() && !metadata.file_type().is_symlink(),
        is_reparse: metadata.file_type().is_symlink(),
    })
}

#[cfg(windows)]
fn inspect_file(file: &File) -> io::Result<FileInspection> {
    windows_handle_inspection(file.as_raw_handle() as HANDLE)
}

#[cfg(windows)]
fn inspect_path(path: &Path, directory: bool) -> io::Result<FileInspection> {
    let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
    wide.push(0);
    let flags = FILE_FLAG_OPEN_REPARSE_POINT
        | if directory {
            FILE_FLAG_BACKUP_SEMANTICS
        } else {
            0
        };
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            flags,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let file = unsafe { File::from_raw_handle(handle as _) };
    windows_handle_inspection(file.as_raw_handle() as HANDLE)
}

#[cfg(windows)]
fn windows_handle_inspection(handle: HANDLE) -> io::Result<FileInspection> {
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(handle, &mut information) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let attributes = information.dwFileAttributes;
    Ok(FileInspection {
        stable: StableIdentity {
            first: information.dwVolumeSerialNumber as u64,
            second: ((information.nFileIndexHigh as u64) << 32) | information.nFileIndexLow as u64,
        },
        links: information.nNumberOfLinks as u64,
        is_file: attributes & FILE_ATTRIBUTE_DIRECTORY == 0,
        is_directory: attributes & FILE_ATTRIBUTE_DIRECTORY != 0,
        is_reparse: attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0,
    })
}

#[derive(Clone, Copy)]
#[cfg_attr(test, derive(Debug, Eq, PartialEq))]
#[allow(clippy::enum_variant_names)]
enum FaultPoint {
    AfterRecoveryRootCreate,
    AfterOperationsDirectoryCreate,
    AfterOperationDirectoryCreate,
    AfterArtifactsDirectoryCreate,
    AfterRecordsDirectoryCreate,
    AfterCandidateArtifactCreate,
    AfterCandidateArtifactCallback,
    AfterCandidateArtifactFsync,
    AfterRollbackArtifactCreate,
    AfterRollbackArtifactCallback,
    AfterRollbackArtifactFsync,
    AfterRecordCreate,
    AfterRecordWrite,
    AfterRecordFsync,
    AfterArtifactsDirectoryFsync,
    AfterRecordsDirectoryFsync,
    AfterOperationDirectoryFsync,
    AfterOperationsDirectoryFsync,
    AfterRecoveryRootFsync,
    AfterOperationRootFsync,
}

#[cfg(not(test))]
fn inject_fault(_point: FaultPoint) -> JournalResult<()> {
    Ok(())
}

#[cfg(test)]
thread_local! {
    static ACTIVE_FAULT: std::cell::Cell<Option<FaultPoint>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn inject_fault(point: FaultPoint) -> JournalResult<()> {
    if ACTIVE_FAULT.get() == Some(point) {
        return Err(JournalError::new(
            "RECOVERY_TEST_FAULT",
            format!("injected recovery fault after {point:?}"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(target_os = "linux")]
    use std::os::fd::AsRawFd;
    use tempfile::TempDir;

    const IDENTITY_HASH: &str = "8360f587a9d73a4bf2c7e2fe0494b8a5ccdb35456850ea5733ace6ab06cc650d";

    fn owner() -> JournalOwnerEvidence {
        JournalOwnerEvidence::new(
            "owner-1".into(),
            JournalRuntimeId::Cli,
            "host-1".into(),
            4242,
            "2026-07-14T12:00:00.000Z".into(),
        )
        .unwrap()
    }

    fn make_binding(operation_id: &str) -> JournalIntentBinding {
        JournalIntentBinding::new(
            DATABASE_IDENTITY.into(),
            7,
            operation_id.into(),
            RecoveryOperation::Restore,
            owner(),
            11,
            JournalIntentPhase::Exclusive,
            "2026-07-14T12:00:01.000Z".into(),
            "2026-07-14T12:00:02.000Z".into(),
            Some(serde_json::json!({"proofOnly": "metadata"})),
        )
        .unwrap()
    }

    fn operation_root() -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let canonical = fs::canonicalize(temp.path()).unwrap();
        let root = canonical.join(IDENTITY_HASH);
        fs::create_dir(&root).unwrap();
        set_private_dir_mode(&root).unwrap();
        (temp, root)
    }

    fn write_artifact(context: ArtifactWriteContext<'_>) -> JournalResult<ArtifactChecks> {
        fs::write(
            context.path(),
            format!("{}\0artifact", context.role().as_str()),
        )
        .unwrap();
        Ok(ArtifactChecks::all_ok())
    }

    #[cfg(target_os = "linux")]
    fn copy_and_seal_fixture(source: &Path, destination: &Path) {
        if source.is_dir() {
            fs::create_dir(destination).unwrap();
            fs::set_permissions(destination, fs::Permissions::from_mode(0o700)).unwrap();
            for entry in fs::read_dir(source).unwrap() {
                let entry = entry.unwrap();
                copy_and_seal_fixture(&entry.path(), &destination.join(entry.file_name()));
            }
        } else {
            fs::copy(source, destination).unwrap();
            fs::set_permissions(destination, fs::Permissions::from_mode(0o400)).unwrap();
        }
    }

    #[cfg(target_os = "linux")]
    fn fixture_binding(updated_at: &str, metadata: JsonValue) -> JournalIntentBinding {
        let golden: JsonValue = serde_json::from_str(include_str!(
            "../../schema/database-operation-recovery-journal-v1-golden.json"
        ))
        .unwrap();
        let record = &golden["preparedMutation"]["record"];
        JournalIntentBinding::new(
            DATABASE_IDENTITY.into(),
            999,
            record["operationId"].as_str().unwrap().into(),
            serde_json::from_value(record["operation"].clone()).unwrap(),
            serde_json::from_value(record["owner"].clone()).unwrap(),
            record["fencingGeneration"].as_u64().unwrap(),
            JournalIntentPhase::Exclusive,
            record["createdAt"].as_str().unwrap().into(),
            updated_at.into(),
            Some(metadata),
        )
        .unwrap()
    }

    fn committed_commitment(
        record_sha256: &str,
        claim_sequence: u64,
    ) -> CommittedRecoveryCommitment {
        CommittedRecoveryCommitment::new(
            PROTOCOL.into(),
            u64::from(PROTOCOL_VERSION),
            record_sha256.into(),
            "linux-fsync-complete".into(),
            claim_sequence,
        )
        .unwrap()
    }

    fn synthetic_operation_root(filler_length: usize) -> PathBuf {
        let filler = "a".repeat(filler_length);
        #[cfg(windows)]
        {
            if filler.is_empty() {
                PathBuf::from(format!(r"C:\{IDENTITY_HASH}"))
            } else {
                PathBuf::from(format!(r"C:\{filler}\{IDENTITY_HASH}"))
            }
        }
        #[cfg(not(windows))]
        {
            if filler.is_empty() {
                PathBuf::from(format!("/{IDENTITY_HASH}"))
            } else {
                PathBuf::from(format!("/{filler}/{IDENTITY_HASH}"))
            }
        }
    }

    fn committed_binding(
        root: &Path,
        source: &JournalIntentBinding,
        record_sha256: &str,
        claim_sequence: u64,
        phase: CommittedRecoveryPhase,
        current_owner: JournalOwnerEvidence,
    ) -> CommittedRecoveryEvidenceBinding {
        CommittedRecoveryEvidenceBinding::new(
            root.to_path_buf(),
            DATABASE_IDENTITY.into(),
            source.state_revision,
            source.operation_id.clone(),
            source.operation,
            phase,
            current_owner,
            source.fencing_generation + claim_sequence,
            source.intent_created_at.clone(),
            source.intent_updated_at.clone(),
            committed_commitment(record_sha256, claim_sequence),
        )
        .unwrap()
    }

    #[cfg(target_os = "linux")]
    fn retained_descriptor_count(root: &Path) -> usize {
        use std::os::unix::ffi::OsStrExt;

        fs::read_dir("/proc/self/fd")
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                fs::read_link(entry.path()).ok().is_some_and(|path| {
                    path.as_os_str()
                        .as_bytes()
                        .starts_with(root.as_os_str().as_bytes())
                })
            })
            .count()
    }

    #[cfg(target_os = "linux")]
    fn rewrite_prepared_record(
        paths: &JournalPaths,
        mutate: impl FnOnce(&mut PreparedRecord),
    ) -> String {
        let old_name = read_names(&paths.records).unwrap().remove(0);
        let old_path = paths.records.join(old_name);
        let bytes = fs::read(&old_path).unwrap();
        let mut record: PreparedRecord = serde_json::from_slice(&bytes[..bytes.len() - 1]).unwrap();
        mutate(&mut record);
        let canonical = canonical_record_bytes(&record).unwrap();
        let hash = record_hash(&canonical);
        fs::remove_file(old_path).unwrap();
        let new_path = paths
            .records
            .join(format!("00000000000000000000-{hash}.json"));
        fs::write(&new_path, [canonical.as_slice(), b"\n"].concat()).unwrap();
        fs::set_permissions(new_path, fs::Permissions::from_mode(0o400)).unwrap();
        hash
    }

    #[test]
    fn cross_platform_golden_vectors_match_node_canonical_hashes_and_paths() {
        let golden: JsonValue = serde_json::from_str(include_str!(
            "../../schema/database-operation-recovery-journal-v1-golden.json"
        ))
        .unwrap();
        for vector in golden["canonicalizationVectors"].as_array().unwrap() {
            let bytes = canonical_json_bytes(&vector["value"]).unwrap();
            assert_eq!(
                String::from_utf8(bytes.clone()).unwrap(),
                vector["canonicalUtf8"].as_str().unwrap()
            );
            assert_eq!(
                sha256_hex(&bytes),
                vector["ordinarySha256"].as_str().unwrap()
            );
        }
        let mut accepted_metadata_bindings: HashMap<String, JournalIntentBinding> = HashMap::new();
        for vector in golden["metadataNumberVectors"].as_array().unwrap() {
            let parsed: JsonValue =
                serde_json::from_str(vector["jsonSource"].as_str().unwrap()).unwrap();
            let metadata = serde_json::json!({"nested": [{"value": parsed}]});
            let original = metadata.clone();
            let normalized = normalize_intent_metadata_value(&metadata);
            assert_eq!(metadata, original, "{}", vector["name"]);
            let binding = JournalIntentBinding::new(
                DATABASE_IDENTITY.into(),
                1,
                "operation-metadata-number".into(),
                RecoveryOperation::Restore,
                owner(),
                1,
                JournalIntentPhase::Exclusive,
                "2026-07-14T12:00:01.000Z".into(),
                "2026-07-14T12:00:02.000Z".into(),
                Some(metadata),
            );
            if vector["accepted"].as_bool().unwrap() {
                let normalized = normalized.unwrap();
                let expected_canonical = vector["canonicalMetadataUtf8"].as_str().unwrap();
                assert_eq!(
                    String::from_utf8(canonical_json_bytes(&normalized).unwrap()).unwrap(),
                    expected_canonical,
                    "{}",
                    vector["name"]
                );
                let binding = binding.unwrap();
                assert_eq!(
                    binding.intent_metadata(),
                    Some(&normalized),
                    "{}",
                    vector["name"]
                );
                if let Some(previous) = accepted_metadata_bindings.get(expected_canonical) {
                    assert_eq!(&binding, previous, "{}", vector["name"]);
                } else {
                    accepted_metadata_bindings.insert(expected_canonical.into(), binding);
                }
            } else {
                assert_eq!(normalized.unwrap_err().code(), "INVALID_RECOVERY_OPTIONS");
                assert_eq!(
                    binding.unwrap_err().code(),
                    "INVALID_RECOVERY_OPTIONS",
                    "{}",
                    vector["name"]
                );
                assert!(vector["canonicalMetadataUtf8"].is_null());
            }
        }
        for vector in golden["identifierLengthVectors"].as_array().unwrap() {
            let value = vector["value"].as_str().unwrap();
            assert_eq!(
                value.chars().count() as u64,
                vector["codePoints"].as_u64().unwrap()
            );
            assert_eq!(value.len() as u64, vector["utf8Bytes"].as_u64().unwrap());
            assert_eq!(
                valid_identifier(value),
                vector["accepted"].as_bool().unwrap()
            );
        }
        assert!(serde_json::from_slice::<JsonValue>(br#""\ud800""#).is_err());
        let prepared = &golden["preparedMutation"];
        let operation_id = prepared["operationId"].as_str().unwrap();
        let operation = operation_key(DATABASE_IDENTITY, operation_id);
        assert_eq!(operation, prepared["operationKey"].as_str().unwrap());
        let nonce = prepared["nonce"].as_str().unwrap();
        assert_eq!(
            artifact_key(&operation, nonce, ArtifactRole::Candidate),
            prepared["artifactKeys"]["candidate"].as_str().unwrap()
        );
        assert_eq!(
            artifact_key(&operation, nonce, ArtifactRole::Rollback),
            prepared["artifactKeys"]["rollback"].as_str().unwrap()
        );
        let record: PreparedRecord = serde_json::from_value(prepared["record"].clone()).unwrap();
        let canonical = canonical_record_bytes(&record).unwrap();
        assert_eq!(
            String::from_utf8(canonical.clone()).unwrap(),
            prepared["canonicalRecordUtf8"].as_str().unwrap()
        );
        assert_eq!(
            record_hash(&canonical),
            prepared["recordHash"].as_str().unwrap()
        );
        assert!(prepared["layout"]["recordPath"]
            .as_str()
            .unwrap()
            .contains(prepared["recordHash"].as_str().unwrap()));
    }

    #[test]
    fn cross_platform_trusted_schema_identity_binds_raw_bytes_version_and_latest_migration() {
        let identity = trusted_schema_identity().unwrap();
        assert_eq!(
            identity.raw_bytes_sha256(),
            "sha256:9c6269cac2ec752914a6ef9178c8b6ab2e9fbbe7db15b5deaf9aaf1e7b829056"
        );
        assert_eq!(identity.contract_version(), 1);
        assert_eq!(identity.latest_migration(), "019_financial_semantics");
    }

    #[test]
    fn cross_platform_binding_rejects_impossible_dates_and_noncanonical_metadata() {
        assert_eq!(
            JournalIntentBinding::new(
                DATABASE_IDENTITY.into(),
                1,
                "operation-zero-generation".into(),
                RecoveryOperation::Restore,
                owner(),
                0,
                JournalIntentPhase::Exclusive,
                "2026-07-14T12:00:01.000Z".into(),
                "2026-07-14T12:00:02.000Z".into(),
                None,
            )
            .unwrap_err()
            .code(),
            "INVALID_RECOVERY_OPTIONS"
        );
        for timestamp in ["2026-02-30T12:00:00.000Z", "2026-07-14T24:00:00.000Z"] {
            assert_eq!(
                JournalIntentBinding::new(
                    DATABASE_IDENTITY.into(),
                    1,
                    "operation-time".into(),
                    RecoveryOperation::Restore,
                    owner(),
                    1,
                    JournalIntentPhase::Exclusive,
                    timestamp.into(),
                    "2026-07-14T12:00:02.000Z".into(),
                    None,
                )
                .unwrap_err()
                .code(),
                "INVALID_RECOVERY_OPTIONS"
            );
        }
        for metadata in [serde_json::json!([]), serde_json::json!({"invalid": -1})] {
            assert_eq!(
                JournalIntentBinding::new(
                    DATABASE_IDENTITY.into(),
                    1,
                    "operation-metadata".into(),
                    RecoveryOperation::Restore,
                    owner(),
                    1,
                    JournalIntentPhase::Exclusive,
                    "2026-07-14T12:00:01.000Z".into(),
                    "2026-07-14T12:00:02.000Z".into(),
                    Some(metadata),
                )
                .unwrap_err()
                .code(),
                "INVALID_RECOVERY_OPTIONS"
            );
        }
    }

    #[test]
    fn committed_binding_constructors_enforce_fixed_values_lineage_and_scalar_limits() {
        for result in [
            CommittedRecoveryCommitment::new(
                "wrong".into(),
                1,
                "a".repeat(64),
                "linux-fsync-complete".into(),
                0,
            ),
            CommittedRecoveryCommitment::new(
                PROTOCOL.into(),
                2,
                "a".repeat(64),
                "linux-fsync-complete".into(),
                0,
            ),
            CommittedRecoveryCommitment::new(
                PROTOCOL.into(),
                1,
                "A".repeat(64),
                "linux-fsync-complete".into(),
                0,
            ),
            CommittedRecoveryCommitment::new(
                PROTOCOL.into(),
                1,
                "a".repeat(64),
                "unknown".into(),
                0,
            ),
            CommittedRecoveryCommitment::new(
                PROTOCOL.into(),
                1,
                "a".repeat(64),
                "linux-fsync-complete".into(),
                MAX_JSON_SAFE_INTEGER + 1,
            ),
        ] {
            assert_eq!(result.unwrap_err().code(), "RECOVERY_COMMITMENT_INVALID");
        }

        let source = make_binding("operation-limit");
        let base_root = synthetic_operation_root(0);
        let base = committed_binding(
            &base_root,
            &source,
            &"a".repeat(64),
            0,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
        );
        let fixed_bytes = [
            DATABASE_IDENTITY,
            "exclusive_intent",
            base.operation_id.as_str(),
            base.operation.as_str(),
            base.phase.as_str(),
            base.owner.owner_id.as_str(),
            "cli",
            base.owner.host_id.as_str(),
            base.owner.process_started_at.as_str(),
            base.created_at.as_str(),
            base.updated_at.as_str(),
            base.recovery_commitment.protocol.as_str(),
            base.recovery_commitment.record_sha256.as_str(),
            base.recovery_commitment.durability.as_str(),
        ]
        .iter()
        .map(|value| value.len())
        .sum::<usize>();
        let root_bytes = MAX_COMMITTED_BINDING_STRING_BYTES - fixed_bytes;
        let root_overhead = synthetic_operation_root(1).to_str().unwrap().len() - 1;
        let filler = root_bytes - root_overhead;
        let at_limit_root = synthetic_operation_root(filler);
        let at_limit = CommittedRecoveryEvidenceBinding::new(
            at_limit_root.clone(),
            DATABASE_IDENTITY.into(),
            1,
            source.operation_id.clone(),
            source.operation,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
            source.fencing_generation,
            source.intent_created_at.clone(),
            source.intent_updated_at.clone(),
            committed_commitment(&"a".repeat(64), 0),
        )
        .unwrap();
        validate_committed_binding(&at_limit).unwrap();
        let over_limit_root = synthetic_operation_root(filler + 1);
        assert_eq!(
            CommittedRecoveryEvidenceBinding::new(
                over_limit_root,
                DATABASE_IDENTITY.into(),
                1,
                source.operation_id,
                source.operation,
                CommittedRecoveryPhase::Mutating,
                source.owner,
                source.fencing_generation,
                source.intent_created_at,
                source.intent_updated_at,
                committed_commitment(&"a".repeat(64), 0),
            )
            .unwrap_err()
            .code(),
            "INVALID_RECOVERY_OPTIONS"
        );
    }

    #[cfg(unix)]
    #[test]
    fn cross_platform_private_directory_creation_helper_is_private_immediately() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("private-at-create");
        create_directory_with_private_mode(&path).unwrap();
        let metadata = fs::symlink_metadata(path).unwrap();
        assert!(metadata.is_dir());
        assert_eq!(metadata.permissions().mode() & 0o077, 0);
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn cross_platform_unsupported_platform_creates_no_paths_or_proof() {
        let temp = TempDir::new().unwrap();
        let absent_parent = temp.path().join("must-not-create");
        let root = absent_parent.join(IDENTITY_HASH);
        let binding = make_binding("operation-unsupported");
        let mut callbacks = 0;
        assert_eq!(
            prepare_mutation_journal(Path::new("relative-root"), &binding, |_| {
                callbacks += 1;
                Ok(ArtifactChecks::all_ok())
            })
            .unwrap_err()
            .code(),
            "INVALID_RECOVERY_OPTIONS"
        );
        assert_eq!(callbacks, 0);
        let error = prepare_mutation_journal(&root, &binding, |_| {
            callbacks += 1;
            Ok(ArtifactChecks::all_ok())
        })
        .unwrap_err();
        assert_eq!(error.code(), "RECOVERY_DURABILITY_FAILURE");
        assert_eq!(callbacks, 0);
        assert!(!absent_parent.exists());

        let committed = committed_binding(
            &root,
            &binding,
            &"a".repeat(64),
            0,
            CommittedRecoveryPhase::Mutating,
            binding.owner.clone(),
        );
        assert_eq!(
            verify_committed_recovery_evidence(&committed)
                .unwrap_err()
                .code(),
            "RECOVERY_DURABILITY_FAILURE"
        );
        assert!(!absent_parent.exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn prepares_verifies_consumes_and_rejects_existing_evidence() {
        let (_temp, root) = operation_root();
        let binding = make_binding("operation-prepare");
        let prepared = prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        assert_eq!(prepared.commitment_sha256().len(), 64);
        assert_eq!(prepared.durability(), platform_durability());
        let (_other_temp, other_root) = operation_root();
        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &other_root, &binding)
                .unwrap_err()
                .code(),
            "PREPARED_PROOF_INVALID"
        );
        let mut wrong_revision = binding.clone();
        wrong_revision.state_revision += 1;
        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &root, &wrong_revision)
                .unwrap_err()
                .code(),
            "PREPARED_PROOF_INVALID"
        );
        let mut wrong_intent = binding.clone();
        wrong_intent.intent_updated_at = "2026-07-14T12:00:03.000Z".into();
        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &root, &wrong_intent)
                .unwrap_err()
                .code(),
            "PREPARED_PROOF_INVALID"
        );

        let mut token = verify_prepared_mutation_proof(prepared.proof(), &root, &binding).unwrap();
        assert_eq!(
            revalidate_verified_prepared_mutation_token(&token, &binding)
                .unwrap()
                .sha256(),
            prepared.commitment_sha256()
        );
        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &root, &binding)
                .unwrap_err()
                .code(),
            "PREPARED_PROOF_ACTIVE"
        );
        release_verified_prepared_mutation_token(&mut token);
        release_verified_prepared_mutation_token(&mut token);
        let mut consumed =
            verify_prepared_mutation_proof(prepared.proof(), &root, &binding).unwrap();
        consume_verified_prepared_mutation_token(&mut consumed);
        consume_verified_prepared_mutation_token(&mut consumed);
        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &root, &binding)
                .unwrap_err()
                .code(),
            "PREPARED_PROOF_USED"
        );

        let mut callbacks = 0;
        let retry = prepare_mutation_journal(&root, &binding, |_| {
            callbacks += 1;
            Ok(ArtifactChecks::all_ok())
        })
        .unwrap_err();
        assert_eq!(retry.code(), "RECOVERY_PREPARATION_INCOMPLETE");
        assert_eq!(callbacks, 0);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn retained_tokens_are_single_active_cloexec_and_poison_recovering() {
        let (_temp, root) = operation_root();
        let binding = make_binding("operation-token-lifecycle");
        let prepared = prepare_mutation_journal(&root, &binding, write_artifact).unwrap();

        let lifecycle = Arc::clone(&prepared.proof().lifecycle);
        assert!(std::thread::spawn(move || {
            let _guard = lifecycle.lock().unwrap();
            panic!("poison proof lifecycle");
        })
        .join()
        .is_err());

        let mut token = verify_prepared_mutation_proof(prepared.proof(), &root, &binding).unwrap();
        let retained = token.retained_evidence.as_ref().unwrap();
        assert_eq!(retained.directories.len() + retained.files.len(), 9);
        for descriptor in retained
            .directories
            .iter()
            .map(|evidence| evidence.file.as_raw_fd())
            .chain(
                retained
                    .files
                    .iter()
                    .map(|evidence| evidence.file.as_raw_fd()),
            )
        {
            let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
            assert_ne!(flags, -1);
            assert_ne!(flags & libc::FD_CLOEXEC, 0);
        }
        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &root, &binding)
                .unwrap_err()
                .code(),
            "PREPARED_PROOF_ACTIVE"
        );
        release_verified_prepared_mutation_token(&mut token);
        assert!(token.retained_evidence.is_none());
        drop(token);

        let token = verify_prepared_mutation_proof(prepared.proof(), &root, &binding).unwrap();
        drop(token);
        let mut consumed =
            verify_prepared_mutation_proof(prepared.proof(), &root, &binding).unwrap();
        consume_verified_prepared_mutation_token(&mut consumed);
        assert!(consumed.retained_evidence.is_none());
        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &root, &binding)
                .unwrap_err()
                .code(),
            "PREPARED_PROOF_USED"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn mutable_shared_roots_allow_churn_but_immutable_layout_does_not() {
        let (_temp, root) = operation_root();
        let binding = make_binding("operation-mutable-root-first");
        let prepared = prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        let mut token = verify_prepared_mutation_proof(prepared.proof(), &root, &binding).unwrap();

        let second_binding = make_binding("operation-mutable-root-second");
        prepare_mutation_journal(&root, &second_binding, write_artifact).unwrap();
        assert_eq!(
            revalidate_verified_prepared_mutation_token(&token, &binding)
                .unwrap()
                .sha256(),
            prepared.commitment_sha256()
        );

        let paths = journal_paths(&root, &binding);
        fs::write(paths.operation.join("unexpected"), b"x").unwrap();
        assert_eq!(
            revalidate_verified_prepared_mutation_token(&token, &binding)
                .unwrap_err()
                .code(),
            "RECOVERY_JOURNAL_CORRUPTION"
        );
        release_verified_prepared_mutation_token(&mut token);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn preparation_ignores_malformed_unrelated_operation_siblings() {
        let (_temp, root) = operation_root();
        let first = make_binding("operation-unrelated-first");
        prepare_mutation_journal(&root, &first, write_artifact).unwrap();
        let operations = journal_paths(&root, &first).operations;
        let malformed = operations.join("malformed-unrelated-sibling");
        fs::write(&malformed, b"not an operation directory").unwrap();

        let second = make_binding("operation-unrelated-second");
        let prepared = prepare_mutation_journal(&root, &second, write_artifact).unwrap();
        assert_eq!(prepared.durability(), JournalDurability::LinuxFsyncComplete);
        assert_eq!(fs::read(&malformed).unwrap(), b"not an operation directory");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn every_existing_operation_shape_is_incomplete_without_callback_or_mutation() {
        use std::os::unix::fs::symlink;

        for kind in ["partial", "complete", "malicious"] {
            let (_temp, root) = operation_root();
            let binding = make_binding(&format!("operation-existing-{kind}"));
            let paths = journal_paths(&root, &binding);
            if kind == "complete" {
                prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
                let record_path = paths.records.join(&read_names(&paths.records).unwrap()[0]);
                fs::set_permissions(&record_path, fs::Permissions::from_mode(0o600)).unwrap();
                fs::write(&record_path, b"malformed existing evidence").unwrap();
                fs::set_permissions(&record_path, fs::Permissions::from_mode(0o400)).unwrap();
            } else {
                let root_identity = validate_operation_root(&root).unwrap();
                ensure_journal_parents(&paths, &root_identity).unwrap();
                if kind == "partial" {
                    fs::create_dir(&paths.operation).unwrap();
                    set_private_dir_mode(&paths.operation).unwrap();
                } else {
                    let outside = root.parent().unwrap().join("malicious-target");
                    fs::write(&outside, b"not a directory").unwrap();
                    symlink(outside, &paths.operation).unwrap();
                }
            }
            let before = fs::symlink_metadata(&paths.operation).unwrap();
            let mut callbacks = 0;
            let error = prepare_mutation_journal(&root, &binding, |_| {
                callbacks += 1;
                Ok(ArtifactChecks::all_ok())
            })
            .unwrap_err();
            let after = fs::symlink_metadata(&paths.operation).unwrap();
            assert_eq!(error.code(), "RECOVERY_PREPARATION_INCOMPLETE", "{kind}");
            assert_eq!(callbacks, 0, "{kind}");
            assert_eq!(
                (after.dev(), after.ino()),
                (before.dev(), before.ino()),
                "{kind}"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rejects_phase_callback_replacement_sidecar_and_artifact_tamper() {
        assert_eq!(
            JournalIntentBinding::new(
                DATABASE_IDENTITY.into(),
                1,
                "operation-phase".into(),
                RecoveryOperation::Restore,
                owner(),
                1,
                JournalIntentPhase::Mutating,
                "2026-07-14T12:00:01.000Z".into(),
                "2026-07-14T12:00:02.000Z".into(),
                None,
            )
            .unwrap_err()
            .code(),
            "INVALID_RECOVERY_OPTIONS"
        );

        let (_temp, root) = operation_root();
        let binding = make_binding("operation-replace");
        let error = prepare_mutation_journal(&root, &binding, |context| {
            fs::remove_file(context.path()).unwrap();
            fs::write(context.path(), b"replacement").unwrap();
            Ok(ArtifactChecks::all_ok())
        })
        .unwrap_err();
        assert_eq!(error.code(), "RECOVERY_ARTIFACT_CORRUPTION");

        let (_temp, root) = operation_root();
        let binding = make_binding("operation-sidecar");
        let error = prepare_mutation_journal(&root, &binding, |context| {
            fs::write(context.path(), context.role().as_str()).unwrap();
            if context.role() == ArtifactRole::Candidate {
                fs::write(format!("{}-wal", context.path().display()), b"sidecar").unwrap();
            }
            Ok(ArtifactChecks::all_ok())
        })
        .unwrap_err();
        assert_eq!(error.code(), "RECOVERY_ARTIFACT_CORRUPTION");

        let (_temp, root) = operation_root();
        let binding = make_binding("operation-tamper");
        let prepared = prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        let paths = journal_paths(&root, &binding);
        let candidate = read_names(&paths.artifacts)
            .unwrap()
            .into_iter()
            .find(|name| name.starts_with("candidate-"))
            .unwrap();
        let candidate = paths.artifacts.join(candidate);
        fs::set_permissions(&candidate, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&candidate, b"tampered").unwrap();
        fs::set_permissions(&candidate, fs::Permissions::from_mode(0o400)).unwrap();
        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &root, &binding)
                .unwrap_err()
                .code(),
            "RECOVERY_ARTIFACT_CORRUPTION"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn validates_shared_static_disk_evidence_without_minting_from_disk() {
        let (_temp, root) = operation_root();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../schema/fixtures/database-operation-recovery-journal-v1/recovery-journal-v1");
        copy_and_seal_fixture(&fixture, &root.join(RECOVERY_DIRECTORY));
        let first_binding = fixture_binding(
            "2031-08-15T13:14:15.000Z",
            serde_json::json!({"proofOnly": ["different", 7]}),
        );
        let first_paths = journal_paths(&root, &first_binding);
        let first = validate_complete_operation(&first_paths, &first_binding).unwrap();
        assert_eq!(
            first.commitment_sha256,
            "3cab58449639e02aaa5eaa9c56a218f5dbeb0b2963ed2c43d0ef201436353666"
        );

        let second_binding = fixture_binding(
            "2032-09-16T14:15:16.000Z",
            serde_json::json!({"another": true}),
        );
        let second =
            validate_complete_operation(&journal_paths(&root, &second_binding), &second_binding)
                .unwrap();
        assert_eq!(second.commitment_sha256, first.commitment_sha256);
        let mut callbacks = 0;
        assert_eq!(
            prepare_mutation_journal(&root, &first_binding, |_| {
                callbacks += 1;
                Ok(ArtifactChecks::all_ok())
            })
            .unwrap_err()
            .code(),
            "RECOVERY_PREPARATION_INCOMPLETE"
        );
        assert_eq!(callbacks, 0);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn committed_verifier_matches_shared_fixture_for_initial_and_repeated_claims() {
        let (_temp, root) = operation_root();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../schema/fixtures/database-operation-recovery-journal-v1/recovery-journal-v1");
        copy_and_seal_fixture(&fixture, &root.join(RECOVERY_DIRECTORY));
        let source = fixture_binding("2031-08-15T13:14:15.000Z", serde_json::json!({}));
        let hash = "3cab58449639e02aaa5eaa9c56a218f5dbeb0b2963ed2c43d0ef201436353666";

        for (sequence, phase) in [
            (0, CommittedRecoveryPhase::Mutating),
            (1, CommittedRecoveryPhase::Mutating),
            (2, CommittedRecoveryPhase::Abandoned),
        ] {
            let current_owner = if sequence == 0 {
                source.owner.clone()
            } else {
                JournalOwnerEvidence::new(
                    format!("claimed-owner-{sequence}"),
                    JournalRuntimeId::Tauri,
                    "claimed-host".into(),
                    5252,
                    "2026-07-14T12:00:00.000Z".into(),
                )
                .unwrap()
            };
            let binding = committed_binding(&root, &source, hash, sequence, phase, current_owner);
            let mut first = verify_committed_recovery_evidence(&binding).unwrap();
            let mut second = verify_committed_recovery_evidence(&binding).unwrap();
            assert_eq!(retained_descriptor_count(&root), 18);
            assert_eq!(
                revalidate_verified_committed_recovery_evidence_token(&first, &binding)
                    .unwrap()
                    .sha256(),
                hash
            );
            release_verified_committed_recovery_evidence_token(&mut first);
            assert_eq!(retained_descriptor_count(&root), 9);
            assert_eq!(
                revalidate_verified_committed_recovery_evidence_token(&second, &binding)
                    .unwrap()
                    .durability(),
                JournalDurability::LinuxFsyncComplete
            );
            release_verified_committed_recovery_evidence_token(&mut second);
            assert_eq!(retained_descriptor_count(&root), 0);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn committed_tokens_are_recovery_only_cloexec_bounded_and_drop_safe() {
        use std::{cell::Cell, rc::Rc};

        let (_temp, root) = operation_root();
        let source = make_binding("operation-committed-token");
        let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
        let binding = committed_binding(
            &root,
            &source,
            prepared.commitment_sha256(),
            0,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
        );
        let hashes = Rc::new(Cell::new(0));
        let observed = Rc::clone(&hashes);
        set_inter_artifact_hash_test_hook(Some(Box::new(move || {
            observed.set(observed.get() + 1);
            Ok(())
        })));
        let mut token = verify_committed_recovery_evidence(&binding).unwrap();
        assert_eq!(hashes.get(), 1);
        let retained = token.retained_evidence.as_ref().unwrap();
        assert_eq!(retained.directories.len() + retained.files.len(), 9);
        assert!(retained.layouts.is_empty());
        for descriptor in retained
            .directories
            .iter()
            .map(|evidence| evidence.file.as_raw_fd())
            .chain(
                retained
                    .files
                    .iter()
                    .map(|evidence| evidence.file.as_raw_fd()),
            )
        {
            let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
            assert_ne!(flags, -1);
            assert_ne!(flags & libc::FD_CLOEXEC, 0);
        }
        revalidate_verified_committed_recovery_evidence_token(&token, &binding).unwrap();
        assert_eq!(hashes.get(), 1);

        // The recovery token neither activates nor consumes the prepared-proof lifecycle.
        let prepared_token =
            verify_prepared_mutation_proof(prepared.proof(), &root, &source).unwrap();
        drop(prepared_token);
        let mut wrong_binding = binding.clone();
        wrong_binding.state_revision += 1;
        assert_eq!(
            revalidate_verified_committed_recovery_evidence_token(&token, &wrong_binding)
                .unwrap_err()
                .code(),
            "RECOVERY_EVIDENCE_BINDING_MISMATCH"
        );
        release_verified_committed_recovery_evidence_token(&mut token);
        release_verified_committed_recovery_evidence_token(&mut token);
        assert_eq!(retained_descriptor_count(&root), 0);
        assert_eq!(
            revalidate_verified_committed_recovery_evidence_token(&token, &binding)
                .unwrap_err()
                .code(),
            "RECOVERY_EVIDENCE_TOKEN_RELEASED"
        );
        set_inter_artifact_hash_test_hook(None);

        let dropped = verify_committed_recovery_evidence(&binding).unwrap();
        assert_eq!(retained_descriptor_count(&root), 9);
        drop(dropped);
        assert_eq!(retained_descriptor_count(&root), 0);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn committed_initial_layout_scans_are_role_aware_bounded_and_classify_invalid_artifact_names() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt};

        let temp = TempDir::new().unwrap();
        let oversized = temp.path().join("oversized");
        fs::create_dir(&oversized).unwrap();
        for index in 0..128 {
            fs::write(oversized.join(format!("entry-{index:03}")), b"x").unwrap();
        }
        let expected = ["entry-000".to_owned()];
        COMMITTED_LAYOUT_ENTRY_READS.with(|count| count.set(0));
        assert_eq!(
            read_bounded_committed_layout(
                &oversized,
                CommittedDirectoryRole::Recovery,
                CommittedLayoutExpectation::Exact(&expected),
            )
            .unwrap_err()
            .code(),
            "RECOVERY_JOURNAL_CORRUPTION"
        );
        assert_eq!(COMMITTED_LAYOUT_ENTRY_READS.with(std::cell::Cell::get), 2);

        let (_temp, root) = operation_root();
        let source = make_binding("operation-committed-invalid-artifact-name");
        let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
        let paths = journal_paths(&root, &source);
        let candidate = read_names(&paths.artifacts)
            .unwrap()
            .into_iter()
            .find(|name| name.starts_with("candidate-"))
            .unwrap();
        fs::rename(
            paths.artifacts.join(candidate),
            paths
                .artifacts
                .join(OsString::from_vec(vec![b'i', b'n', b'v', 0xff])),
        )
        .unwrap();
        let binding = committed_binding(
            &root,
            &source,
            prepared.commitment_sha256(),
            0,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
        );
        assert_eq!(
            verify_committed_recovery_evidence(&binding)
                .unwrap_err()
                .code(),
            "RECOVERY_ARTIFACT_CORRUPTION"
        );
        assert_eq!(retained_descriptor_count(&root), 0);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn committed_revalidation_never_enumerates_and_enforces_role_mutability_snapshots() {
        use std::time::{Duration, SystemTime};

        let (_temp, root) = operation_root();
        let source = make_binding("operation-committed-no-revalidation-enumeration");
        let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
        let binding = committed_binding(
            &root,
            &source,
            prepared.commitment_sha256(),
            0,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
        );
        COMMITTED_LAYOUT_ENTRY_READS.with(|count| count.set(0));
        let mut token = verify_committed_recovery_evidence(&binding).unwrap();
        let reads_after_initial = COMMITTED_LAYOUT_ENTRY_READS.with(std::cell::Cell::get);
        assert_eq!(reads_after_initial, 6);
        assert!(token.retained_evidence.as_ref().unwrap().layouts.is_empty());
        let paths = journal_paths(&root, &source);
        let sibling = paths.operations.join("allowed-operation-sibling");
        fs::create_dir(&sibling).unwrap();
        set_private_dir_mode(&sibling).unwrap();
        revalidate_verified_committed_recovery_evidence_token(&token, &binding).unwrap();
        assert_eq!(
            COMMITTED_LAYOUT_ENTRY_READS.with(std::cell::Cell::get),
            reads_after_initial
        );
        release_verified_committed_recovery_evidence_token(&mut token);

        for attack in ["transient-entry", "timestamp"] {
            let (_temp, root) = operation_root();
            let source = make_binding(&format!("operation-committed-recovery-root-{attack}"));
            let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
            let binding = committed_binding(
                &root,
                &source,
                prepared.commitment_sha256(),
                0,
                CommittedRecoveryPhase::Mutating,
                source.owner.clone(),
            );
            let mut token = verify_committed_recovery_evidence(&binding).unwrap();
            let paths = journal_paths(&root, &source);
            if attack == "transient-entry" {
                let transient = paths.recovery_root.join("transient");
                fs::write(&transient, b"x").unwrap();
                fs::remove_file(transient).unwrap();
            } else {
                File::open(&paths.recovery_root)
                    .unwrap()
                    .set_times(
                        fs::FileTimes::new()
                            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1)),
                    )
                    .unwrap();
            }
            assert_eq!(
                revalidate_verified_committed_recovery_evidence_token(&token, &binding)
                    .unwrap_err()
                    .code(),
                "RECOVERY_JOURNAL_CORRUPTION",
                "{attack}"
            );
            release_verified_committed_recovery_evidence_token(&mut token);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn committed_verifier_rejects_hash_lineage_validation_and_artifact_failures() {
        let (_temp, root) = operation_root();
        let source = make_binding("operation-committed-errors");
        let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
        let mut wrong_hash = committed_binding(
            &root,
            &source,
            &"a".repeat(64),
            0,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
        );
        assert_eq!(
            verify_committed_recovery_evidence(&wrong_hash)
                .unwrap_err()
                .code(),
            "RECOVERY_JOURNAL_CORRUPTION"
        );
        wrong_hash.recovery_commitment.record_sha256 = prepared.commitment_sha256().into();
        wrong_hash.owner.owner_id = "wrong-initial-owner".into();
        assert_eq!(
            verify_committed_recovery_evidence(&wrong_hash)
                .unwrap_err()
                .code(),
            "RECOVERY_LINEAGE_INVALID"
        );
        wrong_hash.owner = source.owner.clone();
        wrong_hash.fencing_generation += 1;
        assert_eq!(
            verify_committed_recovery_evidence(&wrong_hash)
                .unwrap_err()
                .code(),
            "RECOVERY_LINEAGE_INVALID"
        );

        let (_temp, root) = operation_root();
        let mut maximum = make_binding("operation-committed-overflow");
        maximum.fencing_generation = MAX_JSON_SAFE_INTEGER;
        let prepared = prepare_mutation_journal(&root, &maximum, write_artifact).unwrap();
        let overflow = CommittedRecoveryEvidenceBinding::new(
            root,
            DATABASE_IDENTITY.into(),
            maximum.state_revision,
            maximum.operation_id.clone(),
            maximum.operation,
            CommittedRecoveryPhase::Mutating,
            maximum.owner.clone(),
            MAX_JSON_SAFE_INTEGER,
            maximum.intent_created_at.clone(),
            maximum.intent_updated_at.clone(),
            committed_commitment(prepared.commitment_sha256(), 1),
        )
        .unwrap();
        assert_eq!(
            verify_committed_recovery_evidence(&overflow)
                .unwrap_err()
                .code(),
            "RECOVERY_LINEAGE_INVALID"
        );

        for attack in ["operation", "created", "database", "schema", "checks"] {
            let (_temp, root) = operation_root();
            let source = make_binding(&format!("operation-committed-{attack}"));
            prepare_mutation_journal(&root, &source, write_artifact).unwrap();
            let paths = journal_paths(&root, &source);
            let hash = rewrite_prepared_record(&paths, |record| match attack {
                "operation" => record.operation = RecoveryOperation::Import,
                "created" => record.created_at = "2026-07-14T12:00:03.000Z".into(),
                "database" => record.database_identity = "wrong.database".into(),
                "schema" => record.schema_contract.latest_migration = "018_wrong".into(),
                "checks" => record.checks.candidate.integrity_check = "failed".into(),
                _ => unreachable!(),
            });
            let binding = committed_binding(
                &root,
                &source,
                &hash,
                0,
                CommittedRecoveryPhase::Mutating,
                source.owner.clone(),
            );
            let expected = if matches!(attack, "schema" | "checks") {
                "RECOVERY_VALIDATION_FAILED"
            } else {
                "RECOVERY_LINEAGE_INVALID"
            };
            assert_eq!(
                verify_committed_recovery_evidence(&binding)
                    .unwrap_err()
                    .code(),
                expected,
                "{attack}"
            );
            assert_eq!(retained_descriptor_count(&root), 0);
        }

        let (_temp, root) = operation_root();
        let source = make_binding("operation-committed-artifact");
        let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
        let paths = journal_paths(&root, &source);
        let candidate = paths.artifacts.join(
            read_names(&paths.artifacts)
                .unwrap()
                .into_iter()
                .find(|name| name.starts_with("candidate-"))
                .unwrap(),
        );
        fs::set_permissions(&candidate, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&candidate, b"tampered").unwrap();
        fs::set_permissions(&candidate, fs::Permissions::from_mode(0o400)).unwrap();
        let binding = committed_binding(
            &root,
            &source,
            prepared.commitment_sha256(),
            0,
            CommittedRecoveryPhase::Abandoned,
            source.owner.clone(),
        );
        assert_eq!(
            verify_committed_recovery_evidence(&binding)
                .unwrap_err()
                .code(),
            "RECOVERY_ARTIFACT_CORRUPTION"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn verification_modes_preserve_prepared_and_committed_failed_artifact_open_codes() {
        use std::os::unix::fs::symlink;

        let (_temp, root) = operation_root();
        let source = make_binding("operation-mode-specific-artifact-open");
        let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
        let paths = journal_paths(&root, &source);
        let candidate = paths.artifacts.join(
            read_names(&paths.artifacts)
                .unwrap()
                .into_iter()
                .find(|name| name.starts_with("candidate-"))
                .unwrap(),
        );
        let outside = root.parent().unwrap().join("outside-artifact-open");
        fs::copy(&candidate, &outside).unwrap();
        fs::remove_file(&candidate).unwrap();
        symlink(&outside, &candidate).unwrap();

        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &root, &source)
                .unwrap_err()
                .code(),
            "RECOVERY_ARTIFACT_CORRUPTION"
        );
        let committed = committed_binding(
            &root,
            &source,
            prepared.commitment_sha256(),
            0,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
        );
        assert_eq!(
            verify_committed_recovery_evidence(&committed)
                .unwrap_err()
                .code(),
            "RECOVERY_FILESYSTEM_FAILURE"
        );
        assert_eq!(retained_descriptor_count(&root), 0);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn committed_revalidation_rejects_all_nine_path_replacements_and_closes_failures() {
        for boundary in [
            "operation-root",
            "recovery-root",
            "operations-root",
            "operation",
            "artifacts",
            "records",
            "record",
            "candidate",
            "rollback",
        ] {
            let (_temp, root) = operation_root();
            let source = make_binding(&format!("operation-committed-path-{boundary}"));
            let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
            let binding = committed_binding(
                &root,
                &source,
                prepared.commitment_sha256(),
                0,
                CommittedRecoveryPhase::Mutating,
                source.owner.clone(),
            );
            let mut token = verify_committed_recovery_evidence(&binding).unwrap();
            let paths = journal_paths(&root, &source);
            let artifact_names = read_names(&paths.artifacts).unwrap();
            let target = match boundary {
                "operation-root" => root.clone(),
                "recovery-root" => paths.recovery_root.clone(),
                "operations-root" => paths.operations.clone(),
                "operation" => paths.operation.clone(),
                "artifacts" => paths.artifacts.clone(),
                "records" => paths.records.clone(),
                "record" => paths
                    .records
                    .join(read_names(&paths.records).unwrap().remove(0)),
                "candidate" => paths.artifacts.join(
                    artifact_names
                        .iter()
                        .find(|name| name.starts_with("candidate-"))
                        .unwrap(),
                ),
                "rollback" => paths.artifacts.join(
                    artifact_names
                        .iter()
                        .find(|name| name.starts_with("rollback-"))
                        .unwrap(),
                ),
                _ => unreachable!(),
            };
            let backup = root.parent().unwrap().join(format!("backup-{boundary}"));
            fs::rename(&target, &backup).unwrap();
            copy_and_seal_fixture(&backup, &target);
            let expected_code = match boundary {
                "artifacts" | "candidate" | "rollback" => "RECOVERY_ARTIFACT_CORRUPTION",
                _ => "RECOVERY_JOURNAL_CORRUPTION",
            };
            assert_eq!(
                revalidate_verified_committed_recovery_evidence_token(&token, &binding)
                    .unwrap_err()
                    .code(),
                expected_code,
                "{boundary}"
            );
            release_verified_committed_recovery_evidence_token(&mut token);
        }

        for layout_attack in ["artifact-sidecar", "artifact-extra", "operation-extra"] {
            let (_temp, root) = operation_root();
            let source = make_binding(&format!("operation-committed-layout-{layout_attack}"));
            let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
            let binding = committed_binding(
                &root,
                &source,
                prepared.commitment_sha256(),
                0,
                CommittedRecoveryPhase::Mutating,
                source.owner.clone(),
            );
            let mut token = verify_committed_recovery_evidence(&binding).unwrap();
            let paths = journal_paths(&root, &source);
            let expected_code = match layout_attack {
                "artifact-sidecar" => {
                    fs::write(paths.artifacts.join("candidate.sqlite-wal"), b"sidecar").unwrap();
                    "RECOVERY_ARTIFACT_CORRUPTION"
                }
                "artifact-extra" => {
                    fs::write(paths.artifacts.join("unexpected"), b"extra").unwrap();
                    "RECOVERY_ARTIFACT_CORRUPTION"
                }
                "operation-extra" => {
                    fs::write(paths.operation.join("unexpected"), b"extra").unwrap();
                    "RECOVERY_JOURNAL_CORRUPTION"
                }
                _ => unreachable!(),
            };
            assert_eq!(
                revalidate_verified_committed_recovery_evidence_token(&token, &binding)
                    .unwrap_err()
                    .code(),
                expected_code,
                "{layout_attack}"
            );
            release_verified_committed_recovery_evidence_token(&mut token);
        }

        let (_temp, root) = operation_root();
        let source = make_binding("operation-committed-retained-syscall");
        let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
        let binding = committed_binding(
            &root,
            &source,
            prepared.commitment_sha256(),
            0,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
        );
        let mut token = verify_committed_recovery_evidence(&binding).unwrap();
        let paths = journal_paths(&root, &source);
        let rollback = paths.artifacts.join(
            read_names(&paths.artifacts)
                .unwrap()
                .into_iter()
                .find(|name| name.starts_with("rollback-"))
                .unwrap(),
        );
        fs::rename(&rollback, root.join("missing-rollback")).unwrap();
        assert_eq!(
            revalidate_verified_committed_recovery_evidence_token(&token, &binding)
                .unwrap_err()
                .code(),
            "RECOVERY_FILESYSTEM_FAILURE"
        );
        release_verified_committed_recovery_evidence_token(&mut token);

        let (_temp, root) = operation_root();
        let source = make_binding("operation-committed-hash-syscall");
        let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
        let binding = committed_binding(
            &root,
            &source,
            prepared.commitment_sha256(),
            0,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
        );
        let paths = journal_paths(&root, &source);
        let rollback = paths.artifacts.join(
            read_names(&paths.artifacts)
                .unwrap()
                .into_iter()
                .find(|name| name.starts_with("rollback-"))
                .unwrap(),
        );
        let moved = root.join("missing-hash-rollback");
        set_inter_artifact_hash_test_hook(Some(Box::new(move || {
            fs::rename(&rollback, &moved)
                .map_err(|error| JournalError::filesystem("move rollback test artifact", error))
        })));
        assert_eq!(
            verify_committed_recovery_evidence(&binding)
                .unwrap_err()
                .code(),
            "RECOVERY_FILESYSTEM_FAILURE"
        );
        set_inter_artifact_hash_test_hook(None);
        assert_eq!(retained_descriptor_count(&root), 0);

        let (_temp, root) = operation_root();
        let source = make_binding("operation-committed-failed-retention");
        let prepared = prepare_mutation_journal(&root, &source, write_artifact).unwrap();
        let binding = committed_binding(
            &root,
            &source,
            prepared.commitment_sha256(),
            0,
            CommittedRecoveryPhase::Mutating,
            source.owner.clone(),
        );
        set_inter_artifact_hash_test_hook(Some(Box::new(|| {
            Err(JournalError::new(
                "RECOVERY_VALIDATION_FAILED",
                "injected committed inter-hash failure",
            ))
        })));
        assert_eq!(
            verify_committed_recovery_evidence(&binding)
                .unwrap_err()
                .code(),
            "RECOVERY_VALIDATION_FAILED"
        );
        set_inter_artifact_hash_test_hook(None);
        assert_eq!(retained_descriptor_count(&root), 0);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn seals_artifacts_and_record_and_copies_intent_creation_timestamp() {
        let (_temp, root) = operation_root();
        let binding = make_binding("operation-sealed");
        prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        let paths = journal_paths(&root, &binding);
        for entry in fs::read_dir(&paths.artifacts).unwrap() {
            assert_eq!(
                entry.unwrap().metadata().unwrap().permissions().mode() & 0o777,
                0o400
            );
        }
        let record_path = paths
            .records
            .join(read_names(&paths.records).unwrap().remove(0));
        assert_eq!(
            fs::metadata(&record_path).unwrap().permissions().mode() & 0o777,
            0o400
        );
        let bytes = fs::read(record_path).unwrap();
        let record: PreparedRecord = serde_json::from_slice(&bytes[..bytes.len() - 1]).unwrap();
        assert_eq!(record.created_at, binding.intent_created_at());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn retained_revalidation_rejects_immutable_identity_mode_link_time_and_layout_attacks() {
        use std::os::unix::fs::PermissionsExt;

        for attack in [
            "operation-root-replacement",
            "recovery-root-replacement",
            "operations-root-replacement",
            "artifact-file-replacement",
            "artifact-directory-replacement",
            "operation-directory-replacement",
            "same-size-restored-time",
            "mode-flip-restore",
            "hard-link-count",
            "artifact-sidecar",
            "extra-record",
            "extra-operation-entry",
            "extra-recovery-entry",
        ] {
            let (_temp, root) = operation_root();
            let binding = make_binding(&format!("operation-retained-{attack}"));
            let prepared = prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
            let paths = journal_paths(&root, &binding);
            let mut token =
                verify_prepared_mutation_proof(prepared.proof(), &root, &binding).unwrap();
            let artifact = paths.artifacts.join(
                read_names(&paths.artifacts)
                    .unwrap()
                    .into_iter()
                    .next()
                    .unwrap(),
            );
            match attack {
                "operation-root-replacement" => {
                    let old = root.parent().unwrap().join("old-operation-root");
                    fs::rename(&root, &old).unwrap();
                    copy_and_seal_fixture(&old, &root);
                }
                "recovery-root-replacement" => {
                    let old = root.join("old-recovery-root");
                    fs::rename(&paths.recovery_root, &old).unwrap();
                    copy_and_seal_fixture(&old, &paths.recovery_root);
                }
                "operations-root-replacement" => {
                    let old = root.join("old-operations-root");
                    fs::rename(&paths.operations, &old).unwrap();
                    copy_and_seal_fixture(&old, &paths.operations);
                }
                "artifact-file-replacement" => {
                    let replacement = root.join("artifact-replacement");
                    fs::copy(&artifact, &replacement).unwrap();
                    fs::set_permissions(&replacement, fs::Permissions::from_mode(0o400)).unwrap();
                    fs::rename(replacement, &artifact).unwrap();
                }
                "artifact-directory-replacement" => {
                    let old = root.join("old-artifacts");
                    fs::rename(&paths.artifacts, &old).unwrap();
                    copy_and_seal_fixture(&old, &paths.artifacts);
                }
                "operation-directory-replacement" => {
                    let old = root.join("old-operation");
                    fs::rename(&paths.operation, &old).unwrap();
                    copy_and_seal_fixture(&old, &paths.operation);
                }
                "same-size-restored-time" => {
                    let metadata = fs::metadata(&artifact).unwrap();
                    let bytes = fs::read(&artifact).unwrap();
                    fs::set_permissions(&artifact, fs::Permissions::from_mode(0o600)).unwrap();
                    let file = OpenOptions::new().write(true).open(&artifact).unwrap();
                    fs::write(&artifact, bytes).unwrap();
                    fs::set_permissions(&artifact, fs::Permissions::from_mode(0o400)).unwrap();
                    file.set_times(
                        fs::FileTimes::new()
                            .set_accessed(metadata.accessed().unwrap())
                            .set_modified(metadata.modified().unwrap()),
                    )
                    .unwrap();
                }
                "mode-flip-restore" => {
                    fs::set_permissions(&artifact, fs::Permissions::from_mode(0o600)).unwrap();
                    fs::set_permissions(&artifact, fs::Permissions::from_mode(0o400)).unwrap();
                }
                "hard-link-count" => {
                    fs::hard_link(&artifact, root.join("outside-hard-link")).unwrap();
                }
                "artifact-sidecar" => {
                    fs::write(paths.artifacts.join("candidate.sqlite-wal"), b"sidecar").unwrap();
                }
                "extra-record" => {
                    let extra = paths.records.join("extra-record");
                    fs::write(&extra, b"extra").unwrap();
                    fs::set_permissions(extra, fs::Permissions::from_mode(0o400)).unwrap();
                }
                "extra-operation-entry" => {
                    fs::write(paths.operation.join("unexpected"), b"extra").unwrap();
                }
                "extra-recovery-entry" => {
                    fs::write(paths.recovery_root.join("unexpected"), b"extra").unwrap();
                }
                _ => unreachable!(),
            }
            let expected = if matches!(
                attack,
                "same-size-restored-time" | "mode-flip-restore" | "hard-link-count"
            ) {
                "RECOVERY_ARTIFACT_CORRUPTION"
            } else {
                "RECOVERY_JOURNAL_CORRUPTION"
            };
            assert_eq!(
                revalidate_verified_prepared_mutation_token(&token, &binding)
                    .unwrap_err()
                    .code(),
                expected,
                "{attack}"
            );
            release_verified_prepared_mutation_token(&mut token);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn failed_full_verification_drops_every_retained_descriptor_before_token_issuance() {
        use std::os::unix::ffi::OsStrExt;

        let (_temp, root) = operation_root();
        let binding = make_binding("operation-failed-retention");
        prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        let paths = journal_paths(&root, &binding);
        let retained_for_root = || {
            fs::read_dir("/proc/self/fd")
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| {
                    fs::read_link(entry.path()).ok().is_some_and(|path| {
                        path.as_os_str()
                            .as_bytes()
                            .starts_with(root.as_os_str().as_bytes())
                    })
                })
                .count()
        };
        assert_eq!(retained_for_root(), 0);
        assert_eq!(
            validate_complete_operation_with_hook(&paths, &binding, || {
                Err(JournalError::new(
                    "RECOVERY_VALIDATION_FAILED",
                    "injected inter-hash failure",
                ))
            })
            .unwrap_err()
            .code(),
            "RECOVERY_VALIDATION_FAILED"
        );
        assert_eq!(retained_for_root(), 0);
        validate_complete_operation(&paths, &binding).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rejects_over_cap_sparse_artifacts_before_hashing_initial_and_reread() {
        let (_temp, root) = operation_root();
        let binding = make_binding("operation-sparse-initial");
        let error = prepare_mutation_journal(&root, &binding, |context| {
            OpenOptions::new()
                .write(true)
                .open(context.path())
                .unwrap()
                .set_len(MAX_ARTIFACT_BYTES + 1)
                .unwrap();
            Ok(ArtifactChecks::all_ok())
        })
        .unwrap_err();
        assert_eq!(error.code(), "RECOVERY_ARTIFACT_CORRUPTION");

        let (_temp, root) = operation_root();
        let binding = make_binding("operation-sparse-reread");
        let prepared = prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        let paths = journal_paths(&root, &binding);
        let candidate = paths.artifacts.join(
            read_names(&paths.artifacts)
                .unwrap()
                .into_iter()
                .find(|name| name.starts_with("candidate-"))
                .unwrap(),
        );
        fs::set_permissions(&candidate, fs::Permissions::from_mode(0o600)).unwrap();
        OpenOptions::new()
            .write(true)
            .open(&candidate)
            .unwrap()
            .set_len(MAX_ARTIFACT_BYTES + 1)
            .unwrap();
        fs::set_permissions(&candidate, fs::Permissions::from_mode(0o400)).unwrap();
        assert_eq!(
            verify_prepared_mutation_proof(prepared.proof(), &root, &binding)
                .unwrap_err()
                .code(),
            "RECOVERY_ARTIFACT_CORRUPTION"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn retained_handles_reject_sibling_window_write_with_restored_bytes() {
        let (_temp, root) = operation_root();
        let binding = make_binding("operation-sibling-window");
        prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        let paths = journal_paths(&root, &binding);
        let candidate = paths.artifacts.join(
            read_names(&paths.artifacts)
                .unwrap()
                .into_iter()
                .find(|name| name.starts_with("candidate-"))
                .unwrap(),
        );
        let error = validate_complete_operation_with_hook(&paths, &binding, || {
            let original = fs::read(&candidate).unwrap();
            fs::set_permissions(&candidate, fs::Permissions::from_mode(0o600)).unwrap();
            fs::write(&candidate, original).unwrap();
            fs::set_permissions(&candidate, fs::Permissions::from_mode(0o400)).unwrap();
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.code(), "RECOVERY_ARTIFACT_CORRUPTION");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn retained_revalidation_rejects_tamper_without_rehashing() {
        let (_temp, root) = operation_root();
        let binding = make_binding("operation-retained-reread");
        let prepared = prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        let mut token = verify_prepared_mutation_proof(prepared.proof(), &root, &binding).unwrap();
        let paths = journal_paths(&root, &binding);
        let rollback = paths.artifacts.join(
            read_names(&paths.artifacts)
                .unwrap()
                .into_iter()
                .find(|name| name.starts_with("rollback-"))
                .unwrap(),
        );
        fs::set_permissions(&rollback, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&rollback, b"tampered before revalidation").unwrap();
        fs::set_permissions(&rollback, fs::Permissions::from_mode(0o400)).unwrap();
        assert_eq!(
            revalidate_verified_prepared_mutation_token(&token, &binding)
                .unwrap_err()
                .code(),
            "RECOVERY_ARTIFACT_CORRUPTION"
        );
        release_verified_prepared_mutation_token(&mut token);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn invalid_utf8_parent_is_byte_exact_and_symlink_parent_is_rejected() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt, os::unix::fs::symlink};

        let temp = TempDir::new().unwrap();
        let target_parent = temp.path().join(OsString::from_vec(vec![b'p', 0x80]));
        fs::create_dir(&target_parent).unwrap();
        set_private_dir_mode(&target_parent).unwrap();
        let target_root = target_parent.join(IDENTITY_HASH);
        fs::create_dir(&target_root).unwrap();
        set_private_dir_mode(&target_root).unwrap();
        prepare_mutation_journal(
            &target_root,
            &make_binding("operation-invalid-utf8"),
            write_artifact,
        )
        .unwrap();

        let alias_parent = temp.path().join(OsString::from_vec(vec![b'p', 0x81]));
        symlink(&target_parent, &alias_parent).unwrap();
        let alias_root = alias_parent.join(IDENTITY_HASH);
        assert_eq!(
            prepare_mutation_journal(
                &alias_root,
                &make_binding("operation-invalid-utf8-alias"),
                write_artifact,
            )
            .unwrap_err()
            .code(),
            "INVALID_RECOVERY_OPTIONS"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rejects_hardlinks_symlinks_and_public_modes() {
        use std::os::unix::fs::symlink;

        let (_temp, root) = operation_root();
        let binding = make_binding("operation-hardlink");
        let outside = root.parent().unwrap().join("hardlink");
        let error = prepare_mutation_journal(&root, &binding, |context| {
            fs::write(context.path(), b"linked").unwrap();
            fs::hard_link(context.path(), &outside).unwrap();
            Ok(ArtifactChecks::all_ok())
        })
        .unwrap_err();
        assert_eq!(error.code(), "RECOVERY_ARTIFACT_CORRUPTION");

        let (_temp, root) = operation_root();
        let binding = make_binding("operation-public");
        let error = prepare_mutation_journal(&root, &binding, |context| {
            fs::write(context.path(), b"public").unwrap();
            fs::set_permissions(context.path(), fs::Permissions::from_mode(0o644)).unwrap();
            Ok(ArtifactChecks::all_ok())
        })
        .unwrap_err();
        assert_eq!(error.code(), "RECOVERY_ARTIFACT_CORRUPTION");

        let (_temp, target) = operation_root();
        let alias = target.parent().unwrap().join("alias");
        symlink(&target, &alias).unwrap();
        assert_eq!(
            prepare_mutation_journal(&alias, &make_binding("operation-alias"), write_artifact)
                .unwrap_err()
                .code(),
            "INVALID_RECOVERY_OPTIONS"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn every_fault_has_the_required_restart_disposition() {
        let faults = vec![
            FaultPoint::AfterRecoveryRootCreate,
            FaultPoint::AfterOperationsDirectoryCreate,
            FaultPoint::AfterOperationDirectoryCreate,
            FaultPoint::AfterArtifactsDirectoryCreate,
            FaultPoint::AfterRecordsDirectoryCreate,
            FaultPoint::AfterCandidateArtifactCreate,
            FaultPoint::AfterCandidateArtifactCallback,
            FaultPoint::AfterCandidateArtifactFsync,
            FaultPoint::AfterRollbackArtifactCreate,
            FaultPoint::AfterRollbackArtifactCallback,
            FaultPoint::AfterRollbackArtifactFsync,
            FaultPoint::AfterRecordCreate,
            FaultPoint::AfterRecordWrite,
            FaultPoint::AfterRecordFsync,
        ];
        let faults = {
            let mut all_faults = faults;
            all_faults.extend([
                FaultPoint::AfterArtifactsDirectoryFsync,
                FaultPoint::AfterRecordsDirectoryFsync,
                FaultPoint::AfterOperationDirectoryFsync,
                FaultPoint::AfterOperationsDirectoryFsync,
                FaultPoint::AfterRecoveryRootFsync,
                FaultPoint::AfterOperationRootFsync,
            ]);
            all_faults
        };

        for (index, fault) in faults.into_iter().enumerate() {
            let (_temp, root) = operation_root();
            let binding = make_binding(&format!("operation-fault-{index}"));
            ACTIVE_FAULT.set(Some(fault));
            let error = prepare_mutation_journal(&root, &binding, write_artifact).unwrap_err();
            ACTIVE_FAULT.set(None);
            assert_eq!(error.code(), "RECOVERY_TEST_FAULT", "{fault:?}");

            let retry = prepare_mutation_journal(&root, &binding, write_artifact);
            if matches!(
                fault,
                FaultPoint::AfterRecoveryRootCreate | FaultPoint::AfterOperationsDirectoryCreate
            ) {
                retry.unwrap_or_else(|error| panic!("{fault:?}: {error}"));
            } else {
                assert_eq!(
                    retry.unwrap_err().code(),
                    "RECOVERY_PREPARATION_INCOMPLETE",
                    "{fault:?}"
                );
            }
        }
    }

    #[test]
    fn canonical_numbers_reject_negative_and_fractional_values() {
        for source in ["-1", "-0", "1.5", "9007199254740992"] {
            let value: JsonValue = serde_json::from_str(source).unwrap();
            assert_eq!(
                canonical_json_bytes(&value).unwrap_err().code(),
                "RECOVERY_VALIDATION_FAILED"
            );
        }
    }
}
