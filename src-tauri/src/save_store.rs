//! Application-owned persistence. This module never opens WebKit storage.
//! Callers must run these synchronous operations on Tauri's blocking executor.

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const APPLICATION_ID: i64 = 0x41565332;
const SCHEMA_VERSION: i64 = 1;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_VALUE_BYTES: usize = 16 * 1024 * 1024;
const MAX_BATCH_BYTES: usize = 256 * 1024 * 1024;
const MAX_SESSIONS: usize = 64;
const ACTIVATION_CONTENT: &[u8] = b"Aivatar app-owned storage v2 activated\n";
static SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub type StoreResult<T> = Result<T, String>;

/// Development WebViews have a different legacy origin from packaged releases.
/// Their first migration must never activate or shadow the release database.
pub fn storage_directory_name(development: bool) -> &'static str {
    if development { "storage-v2-development" } else { "storage-v2" }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub value: Option<String>,
    pub revision: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub entries: BTreeMap<String, Entry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub session_id: String,
    pub initialized: bool,
    pub snapshot: Snapshot,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrateRequest {
    pub session_id: String,
    pub entries: BTreeMap<String, String>,
    pub raw_entries: BTreeMap<String, String>,
    pub origin: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitRequest {
    pub session_id: String,
    pub operation_id: u64,
    pub expected: BTreeMap<String, u64>,
    pub changes: BTreeMap<String, Option<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Snapshot>,
}

#[derive(Clone)]
struct Receipt {
    request: CommitRequest,
    result: CommitResult,
}

struct Session {
    window_label: String,
    window_generation: u64,
    receipt: Option<Receipt>,
}

#[derive(Default)]
struct Inner {
    connection: Option<Connection>,
    sessions: HashMap<String, Session>,
    uncertain: Option<String>,
    #[cfg(test)]
    fail_after_commit: bool,
}

/// One instance per application, shared by all windows. There is one connection
/// and one writer mutex; receipt history is limited to one result per live window.
pub struct SaveStore {
    directory: PathBuf,
    inner: Mutex<Inner>,
    window_lifetimes: Mutex<HashMap<String, u64>>,
}

pub fn is_allowed_key(key: &str) -> bool {
    if key.len() > 4096 || key.contains('\0') {
        return false;
    }
    const EXACT: &[&str] = &[
        "aivatar.save.v1",
        "aivatar.saveSlots.v1",
        "aivatar.activeSaveSlot.v1",
        "aivatar.defaultLayout.v1",
        "aivatar.taskCabinet.v1",
        "aivatar.uiTheme.v1",
        "aivatar.audioVolume.v1",
        "aivatar.gameConsoleVolume.v1",
        "aivatar.startupSound.v1",
        "aivatar.bgmVolume.v1",
        "aivatar.bgmTrack.v1",
        "aivatar.autoMusic.v1",
        "aivatar.alwaysOnTop.v1",
        "aivatar.locale.v1",
        "aivatar.parkAmbientVolume.v1",
        "aivatar.park.layout.v2",
        "aivatar.assetEditor.v1",
        "aivatar.cardRoom.playerWallet.v1",
        "aivatar.cardRoom.houseBank.v1",
        "aivatar.cardRoom.decor.v1",
    ];
    const PREFIXES: &[&str] = &[
        "aivatar.saveSlot.v1.",
        "aivatar.roomVisitPairCooldown.v1.",
        "aivatar.socialRelationship.v1.",
        "aivatar.socialRoomMemory.v1.",
        "aivatar.cardRoom.playerName.v1.",
        "aivatar.cardRoom.navMemory.v1.",
    ];
    EXACT.contains(&key)
        || PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix) && key.len() > prefix.len())
}

fn validate_value(key: &str, value: Option<&str>) -> StoreResult<usize> {
    if !is_allowed_key(key) {
        return Err(format!("Native storage key is not allowed: {key}"));
    }
    let size = value.map_or(0, str::len);
    if size > MAX_VALUE_BYTES {
        return Err(format!("Native storage value exceeds 16 MiB: {key}"));
    }
    Ok(key.len() + size)
}

fn check_size(size: usize) -> StoreResult<()> {
    if size > MAX_BATCH_BYTES {
        return Err(
            "Native storage request exceeds the 256 MiB limit; no values were dropped.".into(),
        );
    }
    Ok(())
}

fn database_error(error: rusqlite::Error) -> String {
    format!("Native storage database error: {error}")
}

fn file_error(error: std::io::Error) -> String {
    format!("Native storage filesystem error: {error}")
}

fn exists(path: &Path) -> StoreResult<bool> {
    path.try_exists().map_err(file_error)
}

fn validate_activation(path: &Path) -> StoreResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(file_error)?;
    if !metadata.file_type().is_file() || metadata.len() != ACTIVATION_CONTENT.len() as u64 {
        return Err(
            "Native storage activation marker is invalid; explicit recovery is required.".into(),
        );
    }
    if fs::read(path).map_err(file_error)? != ACTIVATION_CONTENT {
        return Err(
            "Native storage activation marker is invalid; explicit recovery is required.".into(),
        );
    }
    Ok(())
}

fn create_activation(path: &Path) -> StoreResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(file_error)?;
    file.write_all(ACTIVATION_CONTENT).map_err(file_error)?;
    file.sync_all().map_err(file_error)?;
    // POSIX directory sync makes the separate activation entry durable before a
    // migration can commit. Windows does not support opening directories this way.
    #[cfg(unix)]
    fs::File::open(path.parent().ok_or("Missing activation directory")?)
        .and_then(|directory| directory.sync_all())
        .map_err(file_error)?;
    Ok(())
}

fn configure(connection: &Connection) -> StoreResult<()> {
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(database_error)?;
    let mode: String = connection
        .query_row("PRAGMA journal_mode=DELETE", [], |row| row.get(0))
        .map_err(database_error)?;
    connection
        .execute_batch("PRAGMA synchronous=EXTRA;")
        .map_err(database_error)?;
    let sync: i64 = connection
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .map_err(database_error)?;
    if !mode.eq_ignore_ascii_case("delete") || sync != 3 {
        return Err("Native storage requires journal_mode=DELETE and synchronous=EXTRA.".into());
    }
    Ok(())
}

fn initialized(connection: &Connection) -> StoreResult<bool> {
    let flag: i64 = connection
        .query_row(
            "SELECT initialized FROM store_state WHERE id=1",
            [],
            |row| row.get(0),
        )
        .map_err(database_error)?;
    match flag {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err("Invalid native migration state; explicit recovery is required.".into()),
    }
}

fn snapshot(connection: &Connection) -> StoreResult<Snapshot> {
    let revision: i64 = connection
        .query_row("SELECT revision FROM store_state WHERE id=1", [], |row| {
            row.get(0)
        })
        .map_err(database_error)?;
    if revision < 0 || revision as u64 > MAX_SAFE_INTEGER {
        return Err("Invalid native storage revision.".into());
    }
    let mut statement = connection
        .prepare("SELECT key, value, revision FROM entries ORDER BY key")
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(database_error)?;
    let mut entries = BTreeMap::new();
    for row in rows {
        let (key, value, entry_revision) = row.map_err(database_error)?;
        validate_value(&key, value.as_deref())?;
        if entry_revision <= 0 || entry_revision > revision {
            return Err(format!("Invalid native entry revision: {key}"));
        }
        entries.insert(
            key,
            Entry {
                value,
                revision: entry_revision as u64,
            },
        );
    }
    Ok(Snapshot {
        revision: revision as u64,
        entries,
    })
}

fn connection<'a>(inner: &'a mut Inner, directory: &Path) -> StoreResult<&'a mut Connection> {
    if let Some(message) = inner.uncertain.as_ref() {
        return Err(message.clone());
    }
    let database_path = directory.join("app-state.sqlite3");
    let activation_path = directory.join("native-activated.v1");
    let marker_exists = exists(&activation_path)?;
    let database_exists = exists(&database_path)?;
    if marker_exists {
        validate_activation(&activation_path)?;
        if !database_exists {
            return Err("Native storage was activated but its database is missing. Legacy data will not be reimported; explicit recovery is required.".into());
        }
    }
    if inner.connection.is_some() {
        if !marker_exists || !database_exists {
            return Err("Native storage files changed while the app was running; explicit recovery is required.".into());
        }
        return Ok(inner.connection.as_mut().expect("checked connection"));
    }
    fs::create_dir_all(directory).map_err(file_error)?;
    if !database_exists {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&database_path)
            .map_err(file_error)?;
        file.sync_all().map_err(file_error)?;
    }
    let mut database =
        Connection::open_with_flags(&database_path, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(database_error)?;
    let app: i64 = database
        .query_row("PRAGMA application_id", [], |row| row.get(0))
        .map_err(database_error)?;
    let schema: i64 = database
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(database_error)?;
    if app == 0 && schema == 0 && !marker_exists {
        let tables: i64 = database
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
                [],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if tables != 0 {
            return Err("Unrecognized native database; explicit recovery is required.".into());
        }
        configure(&database)?;
        let transaction = database
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        transaction.execute_batch(&format!(
            "PRAGMA application_id={APPLICATION_ID};
             PRAGMA user_version={SCHEMA_VERSION};
             CREATE TABLE entries (key TEXT PRIMARY KEY NOT NULL, value TEXT, revision INTEGER NOT NULL CHECK(revision>0));
             CREATE TABLE legacy_raw (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
             CREATE TABLE store_state (id INTEGER PRIMARY KEY CHECK(id=1), initialized INTEGER NOT NULL CHECK(initialized IN (0,1)), revision INTEGER NOT NULL CHECK(revision>=0), origin TEXT);
             INSERT INTO store_state VALUES (1,0,0,NULL);"
        )).map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
    } else if app != APPLICATION_ID || schema != SCHEMA_VERSION {
        return Err("Native database schema is unrecognized; legacy fallback is disabled.".into());
    }
    let integrity: String = database
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(database_error)?;
    if integrity != "ok" {
        return Err(
            "Native database integrity check failed; explicit recovery is required.".into(),
        );
    }
    let complete = initialized(&database)?;
    if !marker_exists {
        if complete {
            return Err("Initialized native database has no activation marker; explicit recovery is required.".into());
        }
        create_activation(&activation_path)?;
    }
    database
        .prepare("SELECT key,value FROM legacy_raw LIMIT 0")
        .map_err(database_error)?;
    snapshot(&database)?;
    configure(&database)?;
    inner.connection = Some(database);
    Ok(inner.connection.as_mut().expect("installed connection"))
}

fn require_session<'a>(
    inner: &'a Inner,
    label: &str,
    session_id: &str,
    generation: u64,
) -> StoreResult<&'a Session> {
    let session = inner
        .sessions
        .get(session_id)
        .ok_or("Native storage session expired. Reload the window to establish a new session.")?;
    if session.window_label != label || session.window_generation != generation {
        return Err("Native storage session belongs to a different window.".into());
    }
    Ok(session)
}

impl SaveStore {
    /// Merely records a Rust-selected application data path. No I/O occurs here.
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            inner: Mutex::new(Inner::default()),
            window_lifetimes: Mutex::new(HashMap::new()),
        }
    }

    /// Read-only observations for the explicitly marked debug integration runner.
    /// The IPC caller must validate the synthetic profile before entering here.
    #[cfg(debug_assertions)]
    pub fn synthetic_diagnostics(&self) -> StoreResult<serde_json::Value> {
        let inner = self.inner.lock().map_err(|_| "Native storage mutex was poisoned")?;
        let database = inner.connection.as_ref().ok_or("Native database is not open")?;
        let journal_mode: String = database.query_row("PRAGMA journal_mode", [], |row| row.get(0)).map_err(database_error)?;
        let synchronous: i64 = database.query_row("PRAGMA synchronous", [], |row| row.get(0)).map_err(database_error)?;
        let page_count: i64 = database.query_row("PRAGMA page_count", [], |row| row.get(0)).map_err(database_error)?;
        let page_size: i64 = database.query_row("PRAGMA page_size", [], |row| row.get(0)).map_err(database_error)?;
        let revision: i64 = database.query_row("SELECT revision FROM store_state WHERE id=1", [], |row| row.get(0)).map_err(database_error)?;
        let file_bytes = fs::metadata(self.directory.join("app-state.sqlite3")).map_err(file_error)?.len();
        Ok(serde_json::json!({"sqliteVersion":rusqlite::version(),"journalMode":journal_mode,
            "synchronous":synchronous,"pageCount":page_count,"pageSize":page_size,
            "databaseBytes":file_bytes,"revision":revision,"liveSessions":inner.sessions.len(),
            "receiptCount":inner.sessions.values().filter(|session| session.receipt.is_some()).count()}))
    }

    pub fn register_window(&self, label: &str) -> StoreResult<u64> {
        let generation = SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        self.window_lifetimes
            .lock()
            .map_err(|_| "Window lifecycle lock was poisoned")?
            .insert(label.into(), generation);
        Ok(generation)
    }

    pub fn expire_window(&self, label: &str, generation: u64) -> StoreResult<()> {
        let mut windows = self
            .window_lifetimes
            .lock()
            .map_err(|_| "Window lifecycle lock was poisoned")?;
        if windows.get(label) == Some(&generation) {
            windows.remove(label);
        }
        Ok(())
    }

    pub fn window_generation(&self, label: &str) -> StoreResult<u64> {
        self.window_lifetimes
            .lock()
            .map_err(|_| "Window lifecycle lock was poisoned")?
            .get(label)
            .copied()
            .ok_or_else(|| "Native window lifecycle has expired".into())
    }

    #[cfg(test)]
    pub fn bootstrap(&self, window_label: &str) -> StoreResult<Bootstrap> {
        let generation = match self.window_generation(window_label) {
            Ok(generation) => generation,
            Err(_) => self.register_window(window_label)?,
        };
        self.bootstrap_window(window_label, generation)
    }

    pub fn bootstrap_window(&self, window_label: &str, generation: u64) -> StoreResult<Bootstrap> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Native storage lock was poisoned")?;
        if self.window_generation(window_label)? != generation {
            return Err("Native window was replaced before bootstrap".into());
        }
        let database = connection(&mut inner, &self.directory)?;
        let initialized = initialized(database)?;
        let snapshot = snapshot(database)?;
        if self.window_generation(window_label)? != generation {
            return Err("Native window was replaced during bootstrap".into());
        }
        inner
            .sessions
            .retain(|_, session| session.window_label != window_label);
        if inner.sessions.len() >= MAX_SESSIONS {
            return Err("Too many active native storage window sessions.".into());
        }
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "System clock is before the epoch")?
            .as_nanos();
        let session_id = format!(
            "{}-{timestamp}-{}",
            std::process::id(),
            SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        inner.sessions.insert(
            session_id.clone(),
            Session {
                window_label: window_label.into(),
                window_generation: generation,
                receipt: None,
            },
        );
        Ok(Bootstrap {
            session_id,
            initialized,
            snapshot,
        })
    }

    pub fn end_window_generation(&self, label: &str, generation: u64) -> StoreResult<()> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Native storage lock was poisoned")?;
        inner.sessions.retain(|_, session| {
            session.window_label != label || session.window_generation != generation
        });
        Ok(())
    }

    pub fn read(&self, label: &str, session_id: &str) -> StoreResult<Snapshot> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Native storage lock was poisoned")?;
        require_session(&inner, label, session_id, self.window_generation(label)?)?;
        let database = connection(&mut inner, &self.directory)?;
        if !initialized(database)? {
            return Err("Native storage migration has not completed.".into());
        }
        snapshot(database)
    }

    pub fn migrate(&self, label: &str, request: MigrateRequest) -> StoreResult<Snapshot> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Native storage lock was poisoned")?;
        require_session(
            &inner,
            label,
            &request.session_id,
            self.window_generation(label)?,
        )?;
        #[cfg(test)]
        let injected_commit_failure = std::mem::take(&mut inner.fail_after_commit);
        #[cfg(not(test))]
        let injected_commit_failure = false;
        let database = connection(&mut inner, &self.directory)?;
        if initialized(database)? {
            return snapshot(database);
        }
        if request.origin.is_empty() || request.origin.len() > 4096 || request.origin.contains('\0')
        {
            return Err("Invalid legacy migration origin.".into());
        }
        let mut size = request.origin.len();
        for (key, value) in request.entries.iter().chain(request.raw_entries.iter()) {
            size = size
                .checked_add(validate_value(key, Some(value))?)
                .ok_or("Migration size overflow")?;
            check_size(size)?;
        }
        let transaction = database
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        // A pending transaction is retryable: rollback leaves both tables empty.
        let pending_rows: i64 = transaction
            .query_row(
                "SELECT (SELECT count(*) FROM entries)+(SELECT count(*) FROM legacy_raw)",
                [],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if pending_rows != 0 {
            return Err(
                "Pending native migration has unexpected rows; explicit recovery is required."
                    .into(),
            );
        }
        for (key, value) in request.raw_entries {
            transaction
                .execute(
                    "INSERT INTO legacy_raw(key,value) VALUES (?1,?2)",
                    params![key, value],
                )
                .map_err(database_error)?;
        }
        for (key, value) in request.entries {
            transaction
                .execute(
                    "INSERT INTO entries(key,value,revision) VALUES (?1,?2,1)",
                    params![key, value],
                )
                .map_err(database_error)?;
        }
        transaction
            .execute(
                "UPDATE store_state SET initialized=1,revision=1,origin=?1 WHERE id=1",
                [request.origin],
            )
            .map_err(database_error)?;
        let result = snapshot(&transaction)?;
        if let Err(failure) = finish_commit(transaction, injected_commit_failure) {
            let message = failure.message();
            inner.uncertain = Some(message.clone());
            return Err(message);
        }
        Ok(result)
    }

    pub fn commit(&self, label: &str, request: CommitRequest) -> StoreResult<CommitResult> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Native storage lock was poisoned")?;
        let session = require_session(
            &inner,
            label,
            &request.session_id,
            self.window_generation(label)?,
        )?;
        if request.operation_id == 0 || request.operation_id > MAX_SAFE_INTEGER {
            return Err("Native storage operationId is outside the supported range.".into());
        }
        if let Some(receipt) = &session.receipt {
            if receipt.request.operation_id == request.operation_id {
                if receipt.request != request {
                    return Err(
                        "Native storage operationId was reused with a different payload.".into(),
                    );
                }
                return Ok(receipt.result.clone());
            }
            if request.operation_id != receipt.request.operation_id + 1 {
                return Err("Stale or out-of-order native storage operationId.".into());
            }
        } else if request.operation_id != 1 {
            return Err("A new native storage session must start at operationId 1.".into());
        }
        let outcome = if let Some(message) = inner.uncertain.as_ref() {
            Err(CommitFailure::Uncertain(message.clone()))
        } else {
            apply_commit(&mut inner, &self.directory, &request)
        };
        let result = match outcome {
            Ok(result) => result,
            Err(mut failure) => {
                // A failed rollback must not be reported as a definite failed write.
                if let Some(database) = inner.connection.as_ref() {
                    if !database.is_autocommit() && database.execute_batch("ROLLBACK").is_err() {
                        failure = CommitFailure::Uncertain("Native rollback could not be confirmed. Restart the application before further saves.".into());
                    }
                }
                let uncertain = matches!(failure, CommitFailure::Uncertain(_));
                let message = failure.message();
                if uncertain {
                    inner.uncertain = Some(message.clone());
                }
                CommitResult {
                    ok: false,
                    kind: Some(if uncertain { "uncertain" } else { "error" }.into()),
                    message: Some(message),
                    snapshot: if uncertain {
                        None
                    } else {
                        inner
                            .connection
                            .as_ref()
                            .and_then(|database| snapshot(database).ok())
                    },
                }
            }
        };
        let session_id = request.session_id.clone();
        inner
            .sessions
            .get_mut(&session_id)
            .ok_or("Native session ended unexpectedly")?
            .receipt = Some(Receipt {
            request,
            result: result.clone(),
        });
        Ok(result)
    }
}

enum CommitFailure {
    Definite(String),
    Uncertain(String),
}
impl From<String> for CommitFailure {
    fn from(message: String) -> Self {
        Self::Definite(message)
    }
}
impl From<&str> for CommitFailure {
    fn from(message: &str) -> Self {
        Self::Definite(message.into())
    }
}
impl CommitFailure {
    fn message(self) -> String {
        match self {
            Self::Definite(message) | Self::Uncertain(message) => message,
        }
    }
}
fn finish_commit(
    transaction: rusqlite::Transaction<'_>,
    injected_failure: bool,
) -> Result<(), CommitFailure> {
    transaction.commit().map_err(|error| CommitFailure::Uncertain(format!("Native COMMIT outcome is uncertain ({error}). Restart the application before further saves; do not repeat the business operation.")))?;
    if injected_failure {
        return Err(CommitFailure::Uncertain("Synthetic I/O failure after COMMIT became visible. Restart the application before further saves; do not repeat the business operation.".into()));
    }
    Ok(())
}

fn apply_commit(
    inner: &mut Inner,
    directory: &Path,
    request: &CommitRequest,
) -> Result<CommitResult, CommitFailure> {
    let mut size = 0usize;
    for (key, value) in &request.changes {
        size = size
            .checked_add(validate_value(key, value.as_deref())?)
            .ok_or("Batch size overflow")?;
        check_size(size)?;
        if !request.expected.contains_key(key) {
            return Err(format!("Missing expected revision for changed key: {key}").into());
        }
    }
    for (key, revision) in &request.expected {
        size = size
            .checked_add(validate_value(key, None)?)
            .ok_or("Batch size overflow")?;
        check_size(size)?;
        if *revision > MAX_SAFE_INTEGER {
            return Err(format!("Expected revision is outside the supported range: {key}").into());
        }
    }
    #[cfg(test)]
    let injected_commit_failure = std::mem::take(&mut inner.fail_after_commit);
    #[cfg(not(test))]
    let injected_commit_failure = false;
    let database = connection(inner, directory)?;
    if !initialized(database)? {
        return Err("Native storage migration has not completed.".into());
    }
    let transaction = database
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    let mut conflict = false;
    for (key, expected) in &request.expected {
        let actual: Option<i64> = transaction
            .query_row("SELECT revision FROM entries WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(database_error)?;
        if actual.unwrap_or(0) as u64 != *expected {
            conflict = true;
            break;
        }
    }
    let result = if conflict {
        let snapshot = snapshot(&transaction)?;
        transaction.rollback().map_err(database_error)?;
        CommitResult {
            ok: false,
            kind: Some("conflict".into()),
            message: None,
            snapshot: Some(snapshot),
        }
    } else {
        let mut changed = Vec::new();
        for (key, value) in &request.changes {
            let previous: Option<Option<String>> = transaction
                .query_row("SELECT value FROM entries WHERE key=?1", [key], |row| {
                    row.get(0)
                })
                .optional()
                .map_err(database_error)?;
            if previous.as_ref() != Some(value) {
                changed.push((key, value));
            }
        }
        if !changed.is_empty() {
            let current: i64 = transaction
                .query_row("SELECT revision FROM store_state WHERE id=1", [], |row| {
                    row.get(0)
                })
                .map_err(database_error)?;
            if current < 0 || current as u64 >= MAX_SAFE_INTEGER {
                return Err("Native storage revision is exhausted.".into());
            }
            let next = current + 1;
            for (key, value) in changed {
                transaction.execute("INSERT INTO entries(key,value,revision) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision", params![key,value,next]).map_err(database_error)?;
            }
            transaction
                .execute("UPDATE store_state SET revision=?1 WHERE id=1", [next])
                .map_err(database_error)?;
        }
        let snapshot = snapshot(&transaction)?;
        finish_commit(transaction, injected_commit_failure)?;
        CommitResult {
            ok: true,
            kind: None,
            message: None,
            snapshot: Some(snapshot),
        }
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::process::Command;
    use std::sync::{Arc, Barrier};
    use std::thread;

    const A: &str = "aivatar.saveSlot.v1.synthetic-a";
    const B: &str = "aivatar.saveSlot.v1.synthetic-b";

    #[test]
    fn development_and_release_databases_have_separate_namespaces() {
        assert_eq!(storage_directory_name(false), "storage-v2");
        assert_eq!(storage_directory_name(true), "storage-v2-development");
        assert_ne!(storage_directory_name(false), storage_directory_name(true));
    }

    fn fixture(label: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("synthetic-test-data")
            .join(format!(
                "{label}-{}-{stamp}-{}",
                std::process::id(),
                SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir_all(&path).unwrap();
        println!("retained synthetic store: {}", path.display());
        path
    }
    fn migration(session: &str, value: &str) -> MigrateRequest {
        MigrateRequest {
            session_id: session.into(),
            entries: BTreeMap::from([(A.into(), value.into())]),
            raw_entries: BTreeMap::from([(
                "aivatar.save.v1".into(),
                "  {\"synthetic\": true}  ".into(),
            )]),
            origin: "http://synthetic.invalid".into(),
        }
    }
    fn ready(label: &str) -> (PathBuf, SaveStore, Bootstrap) {
        let root = fixture(label);
        let store = SaveStore::new(root.clone());
        let bootstrap = store.bootstrap("main").unwrap();
        assert!(!bootstrap.initialized);
        store
            .migrate("main", migration(&bootstrap.session_id, "original"))
            .unwrap();
        (root, store, bootstrap)
    }
    fn request(
        session: &str,
        id: u64,
        expected: &[(&str, u64)],
        changes: &[(&str, Option<&str>)],
    ) -> CommitRequest {
        CommitRequest {
            session_id: session.into(),
            operation_id: id,
            expected: expected
                .iter()
                .map(|(key, rev)| ((*key).into(), *rev))
                .collect(),
            changes: changes
                .iter()
                .map(|(key, value)| ((*key).into(), value.map(str::to_owned)))
                .collect(),
        }
    }
    fn committed(result: &CommitResult) -> &Snapshot {
        assert!(result.ok, "{result:?}");
        result.snapshot.as_ref().unwrap()
    }

    #[test]
    fn pragmas_raw_migration_once_and_restart_are_verified() {
        let (root, store, boot) = ready("restart");
        {
            let inner = store.inner.lock().unwrap();
            let conn = inner.connection.as_ref().unwrap();
            assert_eq!(
                conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
                    .unwrap(),
                "delete"
            );
            assert_eq!(
                conn.query_row("PRAGMA synchronous", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                3
            );
            assert_eq!(
                conn.query_row(
                    "SELECT value FROM legacy_raw WHERE key='aivatar.save.v1'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
                "  {\"synthetic\": true}  "
            );
        }
        let unicode = "{\"nested\":[true,null,9007199254740993],\"text\":\"合成 🐙\"}";
        store
            .commit(
                "main",
                request(&boot.session_id, 1, &[(A, 1)], &[(A, Some(unicode))]),
            )
            .unwrap();
        drop(store);
        let reopened = SaveStore::new(root);
        let fresh = reopened.bootstrap("main").unwrap();
        assert!(fresh.initialized);
        assert_eq!(fresh.snapshot.entries[A].value.as_deref(), Some(unicode));
        let ignored = reopened
            .migrate("main", migration(&fresh.session_id, "stale legacy"))
            .unwrap();
        assert_eq!(ignored, fresh.snapshot);
        assert!(reopened.read("main", &boot.session_id).is_err());
    }

    #[test]
    fn concurrent_windows_have_one_cas_winner_and_no_partial_batch() {
        let (_, store, _) = ready("concurrency");
        let store = Arc::new(store);
        let sessions: Vec<_> = (0..16)
            .map(|index| {
                let label = format!("window-{index}");
                let boot = store.bootstrap(&label).unwrap();
                (label, boot.session_id)
            })
            .collect();
        let barrier = Arc::new(Barrier::new(sessions.len()));
        let jobs: Vec<_> = sessions
            .into_iter()
            .map(|(label, session)| {
                let store = Arc::clone(&store);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    store
                        .commit(
                            &label,
                            request(
                                &session,
                                1,
                                &[(A, 1), (B, 0)],
                                &[(A, Some(&label)), (B, Some(&label))],
                            ),
                        )
                        .unwrap()
                })
            })
            .collect();
        let results: Vec<_> = jobs.into_iter().map(|job| job.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|result| result.ok).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| result.kind.as_deref() == Some("conflict"))
                .count(),
            15
        );
        let final_boot = store.bootstrap("check").unwrap();
        assert_eq!(final_boot.snapshot.revision, 2);
        assert_eq!(
            final_boot.snapshot.entries[A].value,
            final_boot.snapshot.entries[B].value
        );
    }

    #[test]
    fn all_read_preconditions_participate_in_atomic_cas() {
        let (_, store, boot) = ready("prerequisites");
        let failure = store
            .commit(
                "main",
                request(
                    &boot.session_id,
                    1,
                    &[(A, 0), (B, 0)],
                    &[(B, Some("must not persist"))],
                ),
            )
            .unwrap();
        assert_eq!(failure.kind.as_deref(), Some("conflict"));
        let state = failure.snapshot.unwrap();
        assert_eq!(state.revision, 1);
        assert!(!state.entries.contains_key(B));
        assert_eq!(state.entries[A].value.as_deref(), Some("original"));
    }

    #[test]
    fn receipt_replay_is_exact_bounded_and_tombstones_reject_stale_rev() {
        let (_, store, boot) = ready("receipts");
        let first = request(&boot.session_id, 1, &[(A, 1)], &[(A, Some("changed"))]);
        let response = store.commit("main", first.clone()).unwrap();
        assert_eq!(store.commit("main", first.clone()).unwrap(), response);
        let mut changed = first.clone();
        changed.changes.insert(A.into(), Some("different".into()));
        assert!(store.commit("main", changed).is_err());
        let deletion = store
            .commit(
                "main",
                request(&boot.session_id, 2, &[(A, 2)], &[(A, None)]),
            )
            .unwrap();
        assert_eq!(
            committed(&deletion).entries[A],
            Entry {
                value: None,
                revision: 3
            }
        );
        assert!(store.commit("main", first).is_err());
        let stale = store
            .commit(
                "main",
                request(&boot.session_id, 3, &[(A, 0)], &[(A, Some("revive"))]),
            )
            .unwrap();
        assert_eq!(stale.kind.as_deref(), Some("conflict"));
        assert!(stale.snapshot.unwrap().entries[A].value.is_none());
        assert_eq!(
            store.inner.lock().unwrap().sessions[&boot.session_id]
                .receipt
                .as_ref()
                .unwrap()
                .request
                .operation_id,
            3
        );
    }

    #[test]
    fn conflict_error_and_noop_each_have_retryable_receipts() {
        let (_, store, boot) = ready("error-receipts");
        let bad = request(
            &boot.session_id,
            1,
            &[],
            &[(A, Some("missing precondition"))],
        );
        let error = store.commit("main", bad.clone()).unwrap();
        assert_eq!(error.kind.as_deref(), Some("error"));
        assert_eq!(store.commit("main", bad).unwrap(), error);
        let conflict = request(&boot.session_id, 2, &[(A, 9)], &[(A, Some("stale"))]);
        let rejected = store.commit("main", conflict.clone()).unwrap();
        assert_eq!(rejected.kind.as_deref(), Some("conflict"));
        assert_eq!(store.commit("main", conflict).unwrap(), rejected);
        let noop = store
            .commit(
                "main",
                request(&boot.session_id, 3, &[(A, 1)], &[(A, Some("original"))]),
            )
            .unwrap();
        assert_eq!(committed(&noop).revision, 1);
    }

    #[test]
    fn sql_failure_rolls_back_whole_batch_and_is_receipted() {
        let (_, store, boot) = ready("sql-failure");
        store.inner.lock().unwrap().connection.as_ref().unwrap().execute_batch("CREATE TRIGGER synthetic_fail BEFORE INSERT ON entries WHEN NEW.key='aivatar.saveSlot.v1.synthetic-b' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
        let request = request(
            &boot.session_id,
            1,
            &[(A, 1), (B, 0)],
            &[(A, Some("partial")), (B, Some("fail"))],
        );
        let error = store.commit("main", request.clone()).unwrap();
        assert_eq!(error.kind.as_deref(), Some("error"));
        assert_eq!(store.commit("main", request).unwrap(), error);
        let state = store.read("main", &boot.session_id).unwrap();
        assert_eq!(state.entries[A].value.as_deref(), Some("original"));
        assert!(!state.entries.contains_key(B));
        assert_eq!(state.revision, 1);
    }

    #[test]
    fn sessions_are_window_bound_expire_on_reload_destroy_and_reopen() {
        let (_, store, boot) = ready("session-lifecycle");
        assert!(store.read("other", &boot.session_id).is_err());
        let replacement = store.bootstrap("main").unwrap();
        assert!(store.read("main", &boot.session_id).is_err());
        assert!(store.read("main", &replacement.session_id).is_ok());
        let generation = store.window_generation("main").unwrap();
        store.expire_window("main", generation).unwrap();
        store.end_window_generation("main", generation).unwrap();
        assert!(store.read("main", &replacement.session_id).is_err());
        assert!(store.inner.lock().unwrap().sessions.is_empty());
    }

    #[test]
    fn old_window_cleanup_cannot_expire_a_reopened_same_label() {
        let (_, store, old) = ready("window-generation-race");
        let old_generation = store.window_generation("main").unwrap();
        store.expire_window("main", old_generation).unwrap();
        let new_generation = store.register_window("main").unwrap();
        assert_ne!(old_generation, new_generation);
        let fresh = store.bootstrap("main").unwrap();
        // Delayed destruction from the old window arrives after replacement.
        store.expire_window("main", old_generation).unwrap();
        store.end_window_generation("main", old_generation).unwrap();
        assert!(store.read("main", &old.session_id).is_err());
        assert!(store.read("main", &fresh.session_id).is_ok());
        assert_eq!(store.window_generation("main").unwrap(), new_generation);
    }

    #[test]
    fn post_commit_io_failure_is_uncertain_and_freezes_new_operations() {
        let (root, store, boot) = ready("commit-uncertain");
        store.inner.lock().unwrap().fail_after_commit = true;
        let first = request(
            &boot.session_id,
            1,
            &[(A, 1)],
            &[(A, Some("committed-once"))],
        );
        let result = store.commit("main", first.clone()).unwrap();
        assert_eq!(result.kind.as_deref(), Some("uncertain"));
        assert!(result.snapshot.is_none());
        assert_eq!(store.commit("main", first).unwrap(), result);
        let later = store
            .commit(
                "main",
                request(
                    &boot.session_id,
                    2,
                    &[(A, 2)],
                    &[(A, Some("must-not-apply"))],
                ),
            )
            .unwrap();
        assert_eq!(later.kind.as_deref(), Some("uncertain"));
        assert!(store.bootstrap("reload").is_err());
        assert!(store.read("main", &boot.session_id).is_err());
        drop(store);
        // A fresh process/store recovers the database; old IDs cannot be reused.
        let reopened = SaveStore::new(root).bootstrap("main").unwrap();
        assert_eq!(
            reopened.snapshot.entries[A].value.as_deref(),
            Some("committed-once")
        );
        assert_eq!(reopened.snapshot.entries[A].revision, 2);
    }

    #[test]
    fn post_migration_commit_failure_requires_restart_without_reimport() {
        let root = fixture("migration-uncertain");
        let store = SaveStore::new(root.clone());
        let boot = store.bootstrap("main").unwrap();
        store.inner.lock().unwrap().fail_after_commit = true;
        assert!(store
            .migrate("main", migration(&boot.session_id, "committed-import"))
            .unwrap_err()
            .contains("Restart"));
        assert!(store.bootstrap("retry").is_err());
        drop(store);
        let reopened = SaveStore::new(root);
        let boot = reopened.bootstrap("main").unwrap();
        assert!(boot.initialized);
        let snapshot = reopened
            .migrate("main", migration(&boot.session_id, "must-not-reimport"))
            .unwrap();
        assert_eq!(
            snapshot.entries[A].value.as_deref(),
            Some("committed-import")
        );
        assert_eq!(snapshot.revision, 1);
    }

    #[test]
    fn concurrent_initializers_import_once_and_all_observe_same_snapshot() {
        let root = fixture("concurrent-init");
        let store = Arc::new(SaveStore::new(root));
        let barrier = Arc::new(Barrier::new(8));
        let jobs: Vec<_> = (0..8)
            .map(|index| {
                let store = Arc::clone(&store);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    let label = format!("init-{index}");
                    let boot = store.bootstrap(&label).unwrap();
                    barrier.wait();
                    store
                        .migrate(&label, migration(&boot.session_id, &label))
                        .unwrap()
                })
            })
            .collect();
        let results: Vec<_> = jobs.into_iter().map(|job| job.join().unwrap()).collect();
        assert!(results.iter().all(|snapshot| snapshot == &results[0]));
        assert_eq!(results[0].revision, 1);
        assert_eq!(
            store
                .inner
                .lock()
                .unwrap()
                .connection
                .as_ref()
                .unwrap()
                .query_row("SELECT count(*) FROM legacy_raw", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn migration_failure_has_no_rows_or_complete_marker_and_can_retry() {
        let root = fixture("pending-recovery");
        let store = SaveStore::new(root.clone());
        let boot = store.bootstrap("main").unwrap();
        store.inner.lock().unwrap().connection.as_ref().unwrap().execute_batch("CREATE TRIGGER synthetic_migration_fail BEFORE INSERT ON entries BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END;").unwrap();
        assert!(store
            .migrate("main", migration(&boot.session_id, "import"))
            .is_err());
        {
            let inner = store.inner.lock().unwrap();
            let conn = inner.connection.as_ref().unwrap();
            assert!(!initialized(conn).unwrap());
            assert_eq!(snapshot(conn).unwrap(), Snapshot::default());
            assert_eq!(
                conn.query_row("SELECT count(*) FROM legacy_raw", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            conn.execute_batch("DROP TRIGGER synthetic_migration_fail;")
                .unwrap();
        }
        drop(store);
        let reopened = SaveStore::new(root);
        let boot = reopened.bootstrap("main").unwrap();
        assert!(!boot.initialized);
        assert_eq!(
            reopened
                .migrate("main", migration(&boot.session_id, "recovered"))
                .unwrap()
                .entries[A]
                .value
                .as_deref(),
            Some("recovered")
        );
    }

    #[test]
    fn activation_without_database_fails_closed_without_creating_database() {
        let root = fixture("missing-database");
        create_activation(&root.join("native-activated.v1")).unwrap();
        let store = SaveStore::new(root.clone());
        let error = store.bootstrap("main").unwrap_err();
        assert!(error.contains("database is missing"));
        assert!(!root.join("app-state.sqlite3").exists());
    }

    #[test]
    fn corrupted_database_and_complete_database_without_marker_fail_closed() {
        let invalid = fixture("corrupt-database");
        create_activation(&invalid.join("native-activated.v1")).unwrap();
        fs::write(
            invalid.join("app-state.sqlite3"),
            b"synthetic corrupt SQLite bytes",
        )
        .unwrap();
        assert!(SaveStore::new(invalid).bootstrap("main").is_err());
        let (source, store, _) = ready("complete-source");
        drop(store);
        let missing_marker = fixture("missing-marker");
        fs::copy(
            source.join("app-state.sqlite3"),
            missing_marker.join("app-state.sqlite3"),
        )
        .unwrap();
        assert!(SaveStore::new(missing_marker)
            .bootstrap("main")
            .unwrap_err()
            .contains("no activation marker"));
    }

    #[test]
    fn schema_setup_interruption_before_sentinel_recovers_only_empty_pending_state() {
        let root = fixture("zero-byte-pending");
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join("app-state.sqlite3"))
            .unwrap();
        let store = SaveStore::new(root.clone());
        assert!(!store.bootstrap("main").unwrap().initialized);
        assert!(root.join("native-activated.v1").exists());
    }

    #[test]
    fn allowlist_and_size_caps_reject_without_partial_import_or_write() {
        for key in [
            "unrelated.private",
            "aivatar.saveSlot.v1.",
            "aivatar.locale.v1.extra",
            "aivatar.saveSlot.v1.bad\0key",
        ] {
            assert!(!is_allowed_key(key));
        }
        let (_, store, boot) = ready("validation");
        let invalid = store
            .commit(
                "main",
                request(
                    &boot.session_id,
                    1,
                    &[("unrelated.private", 0)],
                    &[("unrelated.private", Some("not accepted"))],
                ),
            )
            .unwrap();
        assert_eq!(invalid.kind.as_deref(), Some("error"));
        let mut oversized = request(&boot.session_id, 2, &[(A, 1)], &[(A, Some("x"))]);
        oversized
            .changes
            .insert(A.into(), Some("x".repeat(MAX_VALUE_BYTES + 1)));
        assert_eq!(
            store.commit("main", oversized).unwrap().kind.as_deref(),
            Some("error")
        );
        assert_eq!(
            store.read("main", &boot.session_id).unwrap().entries[A]
                .value
                .as_deref(),
            Some("original")
        );
    }

    #[test]
    fn repeated_overwrites_keep_database_bounded_and_receipt_history_constant() {
        let (root, store, boot) = ready("overwrite");
        let payload = |index| format!("{index:06}:{}", "x".repeat(20_000));
        let first = store
            .commit(
                "main",
                request(&boot.session_id, 1, &[(A, 1)], &[(A, Some(&payload(0)))]),
            )
            .unwrap();
        let mut revision = committed(&first).entries[A].revision;
        let database = root.join("app-state.sqlite3");
        let baseline = fs::metadata(&database).unwrap().len();
        let mut peak = baseline;
        let start = std::time::Instant::now();
        for index in 1..=1000 {
            let response = store
                .commit(
                    "main",
                    request(
                        &boot.session_id,
                        index + 1,
                        &[(A, revision)],
                        &[(A, Some(&payload(index)))],
                    ),
                )
                .unwrap();
            revision = committed(&response).entries[A].revision;
            peak = peak.max(fs::metadata(&database).unwrap().len());
        }
        let elapsed = start.elapsed().as_secs_f64();
        assert!(peak <= baseline + 65_536);
        assert_eq!(store.inner.lock().unwrap().sessions.len(), 1);
        assert_eq!(
            store.inner.lock().unwrap().sessions[&boot.session_id]
                .receipt
                .as_ref()
                .unwrap()
                .request
                .operation_id,
            1001
        );
        drop(store);
        let reopened = SaveStore::new(root.clone()).bootstrap("main").unwrap();
        assert_eq!(
            reopened.snapshot.entries[A].value.as_deref(),
            Some(payload(1000).as_str())
        );
        let metrics = serde_json::json!({"sqliteVersion":rusqlite::version(),"overwrites":1000,"payloadBytes":20007,"initialDbBytes":baseline,"peakDbBytesAfterCommit":peak,"finalDbBytes":fs::metadata(database).unwrap().len(),"elapsedSeconds":elapsed,"finalRevision":revision,"receiptCount":1});
        fs::write(
            root.join("metrics.json"),
            serde_json::to_vec_pretty(&metrics).unwrap(),
        )
        .unwrap();
        println!("runtime store overwrite metrics: {metrics}");
    }

    #[test]
    fn crash_worker_entry() {
        let Some(root) = std::env::var_os("AIVATAR_SAVE_STORE_CRASH_ROOT") else {
            return;
        };
        let root = PathBuf::from(root).canonicalize().unwrap();
        let allowed = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("synthetic-test-data")
            .canonicalize()
            .unwrap();
        assert_eq!(root.parent().unwrap(), allowed);
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("crash-"));
        let store = SaveStore::new(root);
        store.bootstrap("child").unwrap();
        let inner = store.inner.lock().unwrap();
        let conn = inner.connection.as_ref().unwrap();
        conn.execute_batch("PRAGMA cache_size=5; PRAGMA cache_spill=ON; BEGIN IMMEDIATE;")
            .unwrap();
        for index in 0..64 {
            conn.execute(
                "INSERT OR REPLACE INTO entries VALUES (?1,?2,2)",
                params![
                    format!("aivatar.saveSlot.v1.crash-{index}"),
                    "z".repeat(20_000)
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT OR REPLACE INTO legacy_raw VALUES (?1,?2)",
                params![
                    format!("aivatar.saveSlot.v1.crash-{index}"),
                    "raw".repeat(1000)
                ],
            )
            .unwrap();
        }
        conn.execute(
            "UPDATE store_state SET initialized=1,revision=2 WHERE id=1",
            [],
        )
        .unwrap();
        // Abrupt process exit, deliberately skipping all destructors and COMMIT.
        std::process::exit(73);
    }

    fn crash_fixture(pending: bool) {
        let root = fixture(if pending {
            "crash-migration"
        } else {
            "crash-commit"
        });
        let store = SaveStore::new(root.clone());
        let boot = store.bootstrap("main").unwrap();
        if !pending {
            store
                .migrate("main", migration(&boot.session_id, "committed"))
                .unwrap();
        }
        drop(store);
        let status = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "save_store::tests::crash_worker_entry",
                "--nocapture",
            ])
            .env("AIVATAR_SAVE_STORE_CRASH_ROOT", &root)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(73));
        let journal = root.join("app-state.sqlite3-journal");
        assert!(fs::metadata(&journal).unwrap().len() > 512);
        let mut header = [0; 12];
        fs::File::open(journal)
            .unwrap()
            .read_exact(&mut header)
            .unwrap();
        assert_eq!(
            &header[..8],
            &[0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]
        );
        assert!(u32::from_be_bytes(header[8..12].try_into().unwrap()) > 0);
        let reopened = SaveStore::new(root);
        let after = reopened.bootstrap("main").unwrap();
        assert_eq!(after.initialized, !pending);
        assert!(!after
            .snapshot
            .entries
            .keys()
            .any(|key| key.contains(".crash-")));
        if pending {
            assert_eq!(after.snapshot, Snapshot::default());
            assert_eq!(
                reopened
                    .inner
                    .lock()
                    .unwrap()
                    .connection
                    .as_ref()
                    .unwrap()
                    .query_row("SELECT count(*) FROM legacy_raw", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                reopened
                    .migrate("main", migration(&after.session_id, "retry-after-crash"))
                    .unwrap()
                    .entries[A]
                    .value
                    .as_deref(),
                Some("retry-after-crash")
            );
        } else {
            assert_eq!(
                after.snapshot.entries[A].value.as_deref(),
                Some("committed")
            );
        }
    }
    #[test]
    fn abrupt_commit_process_loss_keeps_only_committed_state() {
        crash_fixture(false);
    }
    #[test]
    fn abrupt_migration_process_loss_keeps_pending_retryable_and_raw_atomic() {
        crash_fixture(true);
    }
}
