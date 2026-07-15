#![allow(dead_code)] // Milestone 4B0b-1 compiles/tests this core without runtime wiring.

use std::{
    collections::{BTreeSet, HashMap},
    error::Error,
    fmt,
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
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
const SCHEMA_CONTRACT_BYTES: &[u8] = include_bytes!("../../schema/shikin-contract.json");
const EXPECTED_SCHEMA_CONTRACT_VERSION: u64 = 1;
const EXPECTED_LATEST_MIGRATION: &str = "019_financial_semantics";
const OPERATION_KEY_DOMAIN: &[u8] =
    b"shikin.database-operation-recovery-journal/v1/operation-key\0";
const ARTIFACT_KEY_DOMAIN: &[u8] = b"shikin.database-operation-recovery-journal/v1/artifact-key\0";
const ARTIFACT_CONTENT_DOMAIN: &[u8] =
    b"shikin.database-operation-recovery-journal/v1/artifact-content\0";
const RECORD_DOMAIN: &[u8] = b"shikin.database-operation-recovery-journal/v1/record\0";

#[derive(Debug)]
pub(crate) struct JournalError {
    code: &'static str,
    message: String,
}

impl JournalError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn filesystem(context: &str, error: io::Error) -> Self {
        Self::new("RECOVERY_FILESYSTEM_FAILURE", format!("{context}: {error}"))
    }

    fn durability(context: &str, error: io::Error) -> Self {
        Self::new("RECOVERY_DURABILITY_FAILURE", format!("{context}: {error}"))
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

impl Error for JournalError {}

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
pub(crate) struct PreparedMutationProof {
    binding: JournalIntentBinding,
    operation_root: PathBuf,
    operation_path: PathBuf,
    commitment_sha256: String,
    durability: JournalDurability,
    used: bool,
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

    pub(crate) fn proof_mut(&mut self) -> &mut PreparedMutationProof {
        &mut self.proof
    }

    pub(crate) fn commitment_sha256(&self) -> &str {
        &self.commitment_sha256
    }

    pub(crate) fn durability(&self) -> JournalDurability {
        self.durability
    }
}

#[derive(Debug)]
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
) -> JournalResult<PreparedCommitment> {
    if proof.used {
        return Err(JournalError::new(
            "PREPARED_PROOF_USED",
            "prepared proof was already consumed",
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
    let root_identity = validate_operation_root(operation_root)?;
    let paths = journal_paths(operation_root, binding);
    if proof.operation_path != paths.operation {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "prepared proof operation path does not match",
        ));
    }
    let evidence = validate_complete_operation(&paths, binding)?;
    revalidate_directory_identity(&root_identity)?;
    if evidence.commitment_sha256 != proof.commitment_sha256
        || evidence.durability != proof.durability
    {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "prepared proof commitment does not match",
        ));
    }
    Ok(PreparedCommitment {
        sha256: evidence.commitment_sha256,
        durability: evidence.durability,
    })
}

pub(crate) fn mark_prepared_mutation_proof_used(
    proof: &mut PreparedMutationProof,
) -> JournalResult<()> {
    if proof.used {
        return Err(JournalError::new(
            "PREPARED_PROOF_USED",
            "prepared proof was already consumed",
        ));
    }
    validate_binding(&proof.binding)?;
    validate_operation_root_argument(&proof.operation_root)?;
    require_linux_durability()?;
    let root_identity = validate_operation_root(&proof.operation_root)?;
    let paths = journal_paths(&proof.operation_root, &proof.binding);
    if proof.operation_path != paths.operation {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "prepared proof operation path does not match",
        ));
    }
    let evidence = validate_complete_operation(&paths, &proof.binding)?;
    revalidate_directory_identity(&root_identity)?;
    if evidence.commitment_sha256 != proof.commitment_sha256
        || evidence.durability != proof.durability
    {
        return Err(JournalError::new(
            "PREPARED_PROOF_INVALID",
            "prepared proof commitment does not match",
        ));
    }
    proof.used = true;
    Ok(())
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
            used: false,
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
    let (digest, size) = hash_open_artifact(&mut file, path, &reserved, role, None)?;
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

fn validate_complete_operation(
    paths: &JournalPaths,
    binding: &JournalIntentBinding,
) -> JournalResult<CompleteEvidence> {
    validate_complete_operation_with_hook(paths, binding, || Ok(()))
}

fn validate_complete_operation_with_hook<F>(
    paths: &JournalPaths,
    binding: &JournalIntentBinding,
    mut between_artifact_hashes: F,
) -> JournalResult<CompleteEvidence>
where
    F: FnMut() -> JournalResult<()>,
{
    require_linux_durability()?;
    let operation_identity = inspect_private_directory(
        &paths.operation,
        "operation directory",
        "RECOVERY_JOURNAL_CORRUPTION",
    )?;
    assert_exact_entries(
        &paths.operation,
        &["artifacts".into(), "records".into()],
        "RECOVERY_JOURNAL_CORRUPTION",
    )?;
    let artifacts_identity = inspect_private_directory(
        &paths.artifacts,
        "artifacts directory",
        "RECOVERY_JOURNAL_CORRUPTION",
    )?;
    let records_identity = inspect_private_directory(
        &paths.records,
        "records directory",
        "RECOVERY_JOURNAL_CORRUPTION",
    )?;
    let record_names = read_names(&paths.records)?;
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
    let bytes = read_secure_file(
        &record_path,
        MAX_RECORD_BYTES,
        "prepared record",
        "RECOVERY_JOURNAL_CORRUPTION",
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
    let record: PreparedRecord = serde_json::from_slice(canonical).map_err(|error| {
        JournalError::new(
            "RECOVERY_JOURNAL_CORRUPTION",
            format!("prepared record is malformed JSON: {error}"),
        )
    })?;
    validate_record(&record, binding, paths)?;
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
    assert_exact_entries(
        &paths.artifacts,
        &expected_artifacts,
        "RECOVERY_ARTIFACT_CORRUPTION",
    )?;
    assert_no_sidecars(&paths.artifacts)?;
    let mut opened = ArtifactRole::all()
        .into_iter()
        .map(|role| {
            let artifact = record.artifact(role);
            open_artifact_evidence(
                &artifact_path(paths, &artifact.path)?,
                role,
                artifact.size_bytes,
            )
        })
        .collect::<JournalResult<Vec<_>>>()?;
    for (index, evidence) in opened.iter_mut().enumerate() {
        let role = evidence.role;
        let artifact = record.artifact(role);
        let (digest, size) = hash_open_artifact(
            &mut evidence.file,
            &evidence.path,
            &evidence.identity,
            role,
            Some(evidence.expected_size),
        )?;
        if digest != artifact.content_digest || size != artifact.size_bytes {
            return Err(JournalError::new(
                "RECOVERY_ARTIFACT_CORRUPTION",
                format!("{} artifact digest or size does not match", role.as_str()),
            ));
        }
        if index == 0 {
            between_artifact_hashes()?;
        }
    }
    for evidence in &opened {
        revalidate_artifact_evidence(evidence)?;
    }
    for identity in [&artifacts_identity, &records_identity, &operation_identity] {
        revalidate_directory_identity(identity)?;
    }
    Ok(CompleteEvidence {
        commitment_sha256,
        durability: platform_durability(),
    })
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
    if path_exists(&paths.operation)? {
        return Ok(vec![recovery_identity, operations_identity]);
    }
    for name in read_names(&paths.operations)? {
        if !is_lower_hex_64(&name) {
            return Err(JournalError::new(
                "RECOVERY_JOURNAL_CORRUPTION",
                "operations directory has unexpected entries",
            ));
        }
        if name != paths.operation_key {
            inspect_private_directory(
                &paths.operations.join(name),
                "operation directory",
                "RECOVERY_JOURNAL_CORRUPTION",
            )?;
        }
    }
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
    let operation_key = operation_key(DATABASE_IDENTITY, &binding.operation_id);
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
            .custom_flags(libc::O_NOFOLLOW);
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
        options.custom_flags(libc::O_NOFOLLOW);
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
) -> JournalResult<StableIdentity> {
    let open = inspect_file(file)
        .map_err(|error| JournalError::new(code, format!("inspect open {label}: {error}")))?;
    let current = inspect_path(path, false)
        .map_err(|error| JournalError::new(code, format!("inspect {label}: {error}")))?;
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
            .map_err(|error| JournalError::new(code, format!("inspect {label}: {error}")))?;
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
) -> JournalResult<()> {
    if &inspect_open_regular_file(file, path, label, code)? != identity {
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
) -> JournalResult<()> {
    revalidate_open_regular_file(file, path, identity, label, code)?;
    #[cfg(unix)]
    {
        let mode = fs::symlink_metadata(path)
            .map_err(|error| JournalError::new(code, format!("inspect {label}: {error}")))?
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
    revalidate_open_sealed_file(file, path, identity, label, code)
}

fn hash_open_artifact(
    file: &mut File,
    path: &Path,
    identity: &StableIdentity,
    role: ArtifactRole,
    expected_size: Option<u64>,
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
    let identity =
        inspect_open_regular_file(&file, path, "artifact", "RECOVERY_ARTIFACT_CORRUPTION")?;
    revalidate_open_sealed_file(
        &file,
        path,
        &identity,
        "artifact",
        "RECOVERY_ARTIFACT_CORRUPTION",
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
    let identity = inspect_open_regular_file(&file, path, label, code)?;
    revalidate_open_sealed_file(&file, path, &identity, label, code)?;
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
    revalidate_open_sealed_file(&file, path, &identity, label, code)?;
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

fn canonical_safe_integer(number: &serde_json::Number) -> Option<u64> {
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

        let paths = journal_paths(&root, &binding);
        let mut proof = PreparedMutationProof {
            binding: binding.clone(),
            operation_root: root.clone(),
            operation_path: paths.operation,
            commitment_sha256: "0".repeat(64),
            durability: JournalDurability::LinuxFsyncComplete,
            used: false,
        };
        assert_eq!(
            verify_prepared_mutation_proof(&proof, &root, &binding)
                .unwrap_err()
                .code(),
            "RECOVERY_DURABILITY_FAILURE"
        );
        assert_eq!(
            mark_prepared_mutation_proof_used(&mut proof)
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
        let mut prepared = prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        assert_eq!(prepared.commitment_sha256().len(), 64);
        assert_eq!(prepared.durability(), platform_durability());
        let commitment = verify_prepared_mutation_proof(prepared.proof(), &root, &binding).unwrap();
        assert_eq!(commitment.sha256(), prepared.commitment_sha256());
        mark_prepared_mutation_proof_used(prepared.proof_mut()).unwrap();
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
    fn mark_used_rereads_and_rejects_tamper() {
        let (_temp, root) = operation_root();
        let binding = make_binding("operation-mark-reread");
        let mut prepared = prepare_mutation_journal(&root, &binding, write_artifact).unwrap();
        let paths = journal_paths(&root, &binding);
        let rollback = paths.artifacts.join(
            read_names(&paths.artifacts)
                .unwrap()
                .into_iter()
                .find(|name| name.starts_with("rollback-"))
                .unwrap(),
        );
        fs::set_permissions(&rollback, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&rollback, b"tampered before consume").unwrap();
        fs::set_permissions(&rollback, fs::Permissions::from_mode(0o400)).unwrap();
        assert_eq!(
            mark_prepared_mutation_proof_used(prepared.proof_mut())
                .unwrap_err()
                .code(),
            "RECOVERY_ARTIFACT_CORRUPTION"
        );
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
