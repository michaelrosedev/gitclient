use std::collections::HashSet;
use std::io::{Read, Write};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

use anyhow::Context;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

pub const STARTED_EVENT: &str = "git-hook://started";
pub const OUTPUT_EVENT: &str = "git-hook://output";
pub const FINISHED_EVENT: &str = "git-hook://finished";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HookName {
    PreCommit,
    PrePush,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HookOutcome {
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HookStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone)]
pub struct HookRunMetadata {
    pub repo_path: String,
    pub run_id: String,
    pub hook: HookName,
    pub operation: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushHookInput {
    pub remote_name: String,
    pub remote_url: String,
    pub local_ref: String,
    pub local_oid: String,
    pub remote_ref: String,
    pub remote_oid: String,
}

pub fn prepare_pre_push(
    repo: &git2::Repository,
    remote_name: &str,
    branch: &str,
    advertised_remote_oid: git2::Oid,
) -> anyhow::Result<Option<PushHookInput>> {
    let remote = repo
        .find_remote(remote_name)
        .with_context(|| format!("remote '{remote_name}' not found"))?;
    let remote_url = remote
        .url()
        .context("remote URL is not valid UTF-8")?
        .to_string();
    let local_ref = format!("refs/heads/{branch}");
    let local_oid = repo
        .refname_to_id(&local_ref)
        .with_context(|| format!("local branch ref '{local_ref}' not found"))?;
    Ok(Some(PushHookInput {
        remote_name: remote_name.to_string(),
        remote_url,
        local_ref: local_ref.clone(),
        local_oid: local_oid.to_string(),
        remote_ref: local_ref,
        remote_oid: advertised_remote_oid.to_string(),
    }))
}

pub fn run_pre_push<R: Runtime>(
    app: &AppHandle<R>,
    metadata: &HookRunMetadata,
    input: PushHookInput,
) -> anyhow::Result<()> {
    let workdir = std::path::PathBuf::from(&metadata.repo_path);
    let stdin = format!(
        "{} {} {} {}\n",
        input.local_ref, input.local_oid, input.remote_ref, input.remote_oid
    );
    ensure_git_hook_run_available(&workdir)?;
    let mut stdin_file =
        tempfile::NamedTempFile::new().context("could not create pre-push input file")?;
    stdin_file
        .write_all(stdin.as_bytes())
        .context("could not write pre-push input file")?;
    stdin_file
        .flush()
        .context("could not flush pre-push input file")?;
    let command = pre_push_command(
        &workdir,
        stdin_file.path(),
        &input.remote_name,
        &input.remote_url,
    );
    let output = stream_command_after_started(app, metadata, command, None)?;
    if !output.status.success() {
        anyhow::bail!("pre-push failed; review hook output");
    }
    Ok(())
}

pub fn emit_started<R: Runtime>(
    app: &AppHandle<R>,
    metadata: &HookRunMetadata,
) -> anyhow::Result<()> {
    app.emit(
        STARTED_EVENT,
        HookStarted {
            repo_path: metadata.repo_path.clone(),
            run_id: metadata.run_id.clone(),
            hook: metadata.hook,
            operation: metadata.operation,
        },
    )
    .context("could not emit hook started event")
}

pub fn emit_finished<R: Runtime>(
    app: &AppHandle<R>,
    metadata: &HookRunMetadata,
    result: &anyhow::Result<()>,
    exit_code: Option<i32>,
    success_summary: &str,
    failure_summary: &str,
) -> anyhow::Result<()> {
    app.emit(
        FINISHED_EVENT,
        HookFinished {
            repo_path: metadata.repo_path.clone(),
            run_id: metadata.run_id.clone(),
            hook: metadata.hook,
            outcome: if result.is_ok() {
                HookOutcome::Succeeded
            } else {
                HookOutcome::Failed
            },
            exit_code,
            summary: if result.is_ok() {
                success_summary
            } else {
                failure_summary
            }
            .to_string(),
        },
    )
    .context("could not emit hook finished event")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStarted {
    pub repo_path: String,
    pub run_id: String,
    pub hook: HookName,
    pub operation: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookOutput {
    pub repo_path: String,
    pub run_id: String,
    pub stream: HookStream,
    pub chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookFinished {
    pub repo_path: String,
    pub run_id: String,
    pub hook: HookName,
    pub outcome: HookOutcome,
    pub exit_code: Option<i32>,
    pub summary: String,
}

static RUN_COUNTER: AtomicU64 = AtomicU64::new(1);
static PROCESS_RUN_PREFIX: OnceLock<String> = OnceLock::new();

fn next_run_id() -> String {
    let prefix = PROCESS_RUN_PREFIX.get_or_init(|| {
        let started = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("{}-{started}", std::process::id())
    });
    let sequence = RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{sequence}")
}

#[derive(Clone, Default)]
pub struct RunRegistry {
    active: Arc<Mutex<HashSet<String>>>,
}

impl RunRegistry {
    pub fn begin(&self, repo_path: &str) -> anyhow::Result<HookRunGuard> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| anyhow::anyhow!("hook run registry lock poisoned"))?;
        if !active.insert(repo_path.to_string()) {
            anyhow::bail!("a hook-aware operation is already running for this repository");
        }
        Ok(HookRunGuard {
            active: Arc::clone(&self.active),
            repo_path: repo_path.to_string(),
            run_id: next_run_id(),
        })
    }
}

#[derive(Debug)]
pub struct HookRunGuard {
    active: Arc<Mutex<HashSet<String>>>,
    repo_path: String,
    run_id: String,
}

impl HookRunGuard {
    pub fn run_id(&self) -> &str {
        &self.run_id
    }
}

impl Drop for HookRunGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.repo_path);
        }
    }
}

fn pre_push_command(
    workdir: &std::path::Path,
    stdin_path: &std::path::Path,
    remote_name: &str,
    remote_url: &str,
) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(workdir)
        .arg("hook")
        .arg("run")
        .arg("--ignore-missing")
        .arg("--to-stdin")
        .arg(stdin_path)
        .arg("pre-push")
        .arg("--")
        .arg(remote_name)
        .arg(remote_url)
        .current_dir(workdir);
    command
}

fn ensure_git_hook_run_available(workdir: &std::path::Path) -> anyhow::Result<()> {
    ensure_git_hook_run_available_with_program(workdir, std::ffi::OsStr::new("git"))
}

fn ensure_git_hook_run_available_with_program(
    workdir: &std::path::Path,
    program: &std::ffi::OsStr,
) -> anyhow::Result<()> {
    let output = Command::new(program)
        .arg("-C")
        .arg(workdir)
        .args(["hook", "run", "-h"])
        .output()
        .context("could not start git to check hook support")?;
    let help = [output.stdout, output.stderr].concat();
    if !String::from_utf8_lossy(&help).contains("git hook run") {
        anyhow::bail!(
            "installed Git does not support 'git hook run'; upgrade Git to run pre-push hooks"
        );
    }
    Ok(())
}

#[cfg(test)]
fn decode_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

enum ReaderMessage {
    Chunk(HookStream, String),
    Error(std::io::Error),
}

fn send_decoded(
    pending: &mut Vec<u8>,
    stream: HookStream,
    sender: &mpsc::Sender<ReaderMessage>,
    eof: bool,
) -> bool {
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                if !text.is_empty()
                    && sender
                        .send(ReaderMessage::Chunk(stream, text.to_string()))
                        .is_err()
                {
                    return false;
                }
                pending.clear();
                return true;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                if valid_up_to > 0 {
                    let valid = std::str::from_utf8(&pending[..valid_up_to])
                        .expect("UTF-8 error's valid prefix must be valid");
                    if sender
                        .send(ReaderMessage::Chunk(stream, valid.to_string()))
                        .is_err()
                    {
                        return false;
                    }
                    pending.drain(..valid_up_to);
                    continue;
                }
                match error.error_len() {
                    Some(invalid_length) => {
                        if sender
                            .send(ReaderMessage::Chunk(stream, "\u{fffd}".to_string()))
                            .is_err()
                        {
                            return false;
                        }
                        pending.drain(..invalid_length);
                    }
                    None if eof => {
                        if sender
                            .send(ReaderMessage::Chunk(
                                stream,
                                String::from_utf8_lossy(pending).into_owned(),
                            ))
                            .is_err()
                        {
                            return false;
                        }
                        pending.clear();
                        return true;
                    }
                    None => return true,
                }
            }
        }
    }
}

fn read_stream(mut reader: impl Read, stream: HookStream, sender: mpsc::Sender<ReaderMessage>) {
    let mut buffer = [0_u8; 4096];
    let mut pending = Vec::new();
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => {
                send_decoded(&mut pending, stream, &sender, true);
                break;
            }
            Ok(length) => {
                pending.extend_from_slice(&buffer[..length]);
                if !send_decoded(&mut pending, stream, &sender, false) {
                    break;
                }
            }
            Err(error) => {
                let _ = sender.send(ReaderMessage::Error(error));
                break;
            }
        }
    }
}

pub fn stream_command<R: Runtime>(
    app: &AppHandle<R>,
    metadata: &HookRunMetadata,
    command: Command,
    stdin: Option<Vec<u8>>,
) -> anyhow::Result<Output> {
    stream_command_inner(app, metadata, command, stdin, true)
}

pub fn stream_command_after_started<R: Runtime>(
    app: &AppHandle<R>,
    metadata: &HookRunMetadata,
    command: Command,
    stdin: Option<Vec<u8>>,
) -> anyhow::Result<Output> {
    stream_command_inner(app, metadata, command, stdin, false)
}

fn stream_command_inner<R: Runtime>(
    app: &AppHandle<R>,
    metadata: &HookRunMetadata,
    mut command: Command,
    stdin: Option<Vec<u8>>,
    start_event: bool,
) -> anyhow::Result<Output> {
    if start_event {
        emit_started(app, metadata)?;
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command.spawn().context("could not start hook command")?;
    let stdout = child
        .stdout
        .take()
        .context("hook command stdout was not piped")?;
    let stderr = child
        .stderr
        .take()
        .context("hook command stderr was not piped")?;
    let child_stdin = child.stdin.take();
    let (sender, receiver) = mpsc::channel();

    let stream_result = std::thread::scope(|scope| -> anyhow::Result<()> {
        let stdout_sender = sender.clone();
        scope.spawn(move || read_stream(stdout, HookStream::Stdout, stdout_sender));
        let stderr_sender = sender.clone();
        scope.spawn(move || read_stream(stderr, HookStream::Stderr, stderr_sender));
        if let (Some(mut child_stdin), Some(input)) = (child_stdin, stdin) {
            let stdin_sender = sender.clone();
            scope.spawn(move || {
                if let Err(error) = child_stdin.write_all(&input) {
                    let _ = stdin_sender.send(ReaderMessage::Error(error));
                }
            });
        }
        drop(sender);

        for message in receiver {
            match message {
                ReaderMessage::Chunk(stream, chunk) => {
                    if let Err(error) = app
                        .emit(
                            OUTPUT_EVENT,
                            HookOutput {
                                repo_path: metadata.repo_path.clone(),
                                run_id: metadata.run_id.clone(),
                                stream,
                                chunk,
                            },
                        )
                        .context("could not emit hook output event")
                    {
                        let _ = child.kill();
                        return Err(error);
                    }
                }
                ReaderMessage::Error(error) => {
                    let _ = child.kill();
                    return Err(error).context("could not stream hook command output");
                }
            }
        }
        Ok(())
    });

    let wait_result = child.wait().context("could not wait for hook command");
    stream_result?;
    let status = wait_result?;
    Ok(Output {
        status,
        stdout: Vec::new(),
        stderr: Vec::new(),
    })
}

pub fn run_commit<R: Runtime>(
    app: &AppHandle<R>,
    repo_path: &std::path::Path,
    run_id: &str,
    message: &str,
    pre_commit_enabled: bool,
) -> anyhow::Result<String> {
    run_commit_with_program(
        app,
        repo_path,
        run_id,
        message,
        pre_commit_enabled,
        std::ffi::OsStr::new("git"),
    )
}

#[derive(Debug, Clone, Copy)]
enum CommitFailurePhase {
    Launch,
    Commit,
    Refresh,
}

impl CommitFailurePhase {
    fn summary(self) -> &'static str {
        match self {
            Self::Launch => "could not start git commit",
            Self::Commit => "commit failed; review hook output",
            Self::Refresh => "commit completed but repository state could not be refreshed",
        }
    }
}

fn run_commit_with_program<R: Runtime>(
    app: &AppHandle<R>,
    repo_path: &std::path::Path,
    run_id: &str,
    message: &str,
    pre_commit_enabled: bool,
    program: &std::ffi::OsStr,
) -> anyhow::Result<String> {
    let repo_path_string = repo_path
        .to_str()
        .context("open repository path is not valid UTF-8")?
        .to_string();
    let metadata = HookRunMetadata {
        repo_path: repo_path_string,
        run_id: run_id.to_string(),
        hook: HookName::PreCommit,
        operation: "commit",
    };
    let mut command = Command::new(program);
    command
        .arg("-C")
        .arg(repo_path)
        .arg("commit")
        .current_dir(repo_path);
    if !pre_commit_enabled {
        command.arg("--no-verify");
    }
    command.arg("-m").arg(message);

    let command_result = stream_command(app, &metadata, command, None);
    let exit_code = command_result
        .as_ref()
        .ok()
        .and_then(|output| output.status.code());
    let phased_result: Result<String, (CommitFailurePhase, anyhow::Error)> = match command_result {
        Err(error) => Err((CommitFailurePhase::Launch, error)),
        Ok(output) if !output.status.success() => Err((
            CommitFailurePhase::Commit,
            anyhow::anyhow!("commit failed; review hook output"),
        )),
        Ok(_) => (|| {
            let repo = git2::Repository::open(repo_path).context("could not reopen repository")?;
            let oid = repo
                .head()
                .context("could not resolve HEAD")?
                .peel_to_commit()
                .context("could not resolve HEAD to a commit")?
                .id();
            Ok(oid.to_string())
        })()
        .map_err(|error| (CommitFailurePhase::Refresh, error)),
    };
    let (outcome, summary) = match &phased_result {
        Ok(_) => (HookOutcome::Succeeded, "commit completed"),
        Err((phase, _)) => (HookOutcome::Failed, phase.summary()),
    };
    let emit_result = app.emit(
        FINISHED_EVENT,
        HookFinished {
            repo_path: metadata.repo_path.clone(),
            run_id: metadata.run_id.clone(),
            hook: HookName::PreCommit,
            outcome,
            exit_code,
            summary: summary.to_string(),
        },
    );
    match phased_result {
        Err((_, error)) => Err(error),
        Ok(oid) => {
            emit_result.context("could not emit hook finished event")?;
            Ok(oid)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use tauri::Listener;

    struct PushFixture {
        directory: tempfile::TempDir,
        remote_directory: tempfile::TempDir,
        local_oid: git2::Oid,
        remote_oid: git2::Oid,
    }

    impl PushFixture {
        fn new() -> Self {
            Self::build(true)
        }

        fn without_remote_branch() -> Self {
            Self::build(false)
        }

        fn build(with_remote_branch: bool) -> Self {
            let directory = tempfile::tempdir().unwrap();
            let remote_directory = tempfile::tempdir().unwrap();
            let git = |directory: &Path, args: &[&str]| {
                let output = Command::new("git")
                    .arg("-C")
                    .arg(directory)
                    .args(args)
                    .output()
                    .unwrap();
                assert!(
                    output.status.success(),
                    "git {args:?} failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
            };
            git(directory.path(), &["init", "-b", "main"]);
            git(directory.path(), &["config", "user.name", "Git Wasp Test"]);
            git(
                directory.path(),
                &["config", "user.email", "git-wasp@example.test"],
            );
            std::fs::write(directory.path().join("file.txt"), "initial\n").unwrap();
            git(directory.path(), &["add", "file.txt"]);
            git(directory.path(), &["commit", "-m", "initial"]);
            git(remote_directory.path(), &["init", "--bare"]);
            let remote_url = remote_directory.path().to_str().unwrap();
            git(directory.path(), &["remote", "add", "origin", remote_url]);
            if with_remote_branch {
                git(directory.path(), &["push", "origin", "main"]);
            }
            let repo = git2::Repository::open(directory.path()).unwrap();
            let local_oid = repo.refname_to_id("refs/heads/main").unwrap();
            let remote_oid = if with_remote_branch {
                repo.refname_to_id("refs/remotes/origin/main").unwrap()
            } else {
                git2::Oid::zero()
            };
            drop(repo);
            Self {
                directory,
                remote_directory,
                local_oid,
                remote_oid,
            }
        }

        fn repo(&self) -> git2::Repository {
            git2::Repository::open(self.directory.path()).unwrap()
        }

        fn remote_url(&self) -> String {
            self.remote_directory.path().display().to_string()
        }

        fn local_oid(&self) -> String {
            self.local_oid.to_string()
        }

        fn remote_oid(&self) -> git2::Oid {
            self.remote_oid
        }

        fn configure_hooks_path(&self, path: &str) {
            let mut config = self.repo().config().unwrap();
            config.set_str("core.hooksPath", path).unwrap();
        }

        #[cfg(unix)]
        fn install_hook(&self, path: &str, contents: &str) {
            use std::os::unix::fs::PermissionsExt;
            let path = self.directory.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, contents).unwrap();
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(path, permissions).unwrap();
        }

        #[cfg(windows)]
        fn install_hook(&self, path: &str, contents: &str) {
            let path = self.directory.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, contents).unwrap();
        }

        #[cfg(unix)]
        fn install_non_executable_hook(&self, name: &str, contents: &str) {
            use std::os::unix::fs::PermissionsExt;
            let path = self.directory.path().join(".git/hooks").join(name);
            std::fs::write(&path, contents).unwrap();
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o644);
            std::fs::set_permissions(path, permissions).unwrap();
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn pre_push_honors_core_hooks_path_and_builds_git_input() {
        let fixture = PushFixture::new();
        fixture.configure_hooks_path(".custom-hooks");
        fixture.install_hook(
            ".custom-hooks/pre-push",
            "#!/bin/sh\ncat > .git/pre-push-stdin\nprintf '%s\\n%s\\n' \"$1\" \"$2\" > .git/pre-push-args\n",
        );
        let input = prepare_pre_push(&fixture.repo(), "origin", "main", fixture.remote_oid())
            .unwrap()
            .unwrap();
        assert_eq!(input.remote_name, "origin");
        assert_eq!(input.remote_url, fixture.remote_url());
        assert_eq!(input.local_ref, "refs/heads/main");
        assert_eq!(input.local_oid, fixture.local_oid());
        assert_eq!(input.remote_ref, "refs/heads/main");
        let expected_stdin = format!(
            "{} {} {} {}\n",
            input.local_ref, input.local_oid, input.remote_ref, input.remote_oid
        );
        let app = tauri::test::mock_app();
        let metadata = HookRunMetadata {
            repo_path: fixture.directory.path().display().to_string(),
            run_id: "pre-push-input".into(),
            hook: HookName::PrePush,
            operation: "push",
        };
        emit_started(app.handle(), &metadata).unwrap();
        run_pre_push(app.handle(), &metadata, input).unwrap();
        assert_eq!(
            std::fs::read_to_string(fixture.directory.path().join(".git/pre-push-stdin")).unwrap(),
            expected_stdin
        );
        assert_eq!(
            std::fs::read_to_string(fixture.directory.path().join(".git/pre-push-args")).unwrap(),
            format!("origin\n{}\n", fixture.remote_url())
        );
    }

    #[test]
    fn first_push_uses_zero_remote_oid() {
        let fixture = PushFixture::without_remote_branch();
        #[cfg(unix)]
        fixture.install_hook(".git/hooks/pre-push", "#!/bin/sh\nexit 0\n");
        let input = prepare_pre_push(&fixture.repo(), "origin", "main", git2::Oid::zero())
            .unwrap()
            .unwrap();
        assert_eq!(input.remote_oid, "0000000000000000000000000000000000000000");
    }

    #[cfg(unix)]
    #[test]
    fn missing_or_non_executable_pre_push_is_skipped_by_git_hook_run() {
        let fixture = PushFixture::new();
        let input = prepare_pre_push(&fixture.repo(), "origin", "main", fixture.remote_oid())
            .unwrap()
            .unwrap();
        let app = tauri::test::mock_app();
        let metadata = HookRunMetadata {
            repo_path: fixture.directory.path().display().to_string(),
            run_id: "missing-hook".into(),
            hook: HookName::PrePush,
            operation: "push",
        };
        emit_started(app.handle(), &metadata).unwrap();
        run_pre_push(app.handle(), &metadata, input.clone()).unwrap();
        fixture.install_non_executable_hook("pre-push", "#!/bin/sh\nexit 1\n");
        run_pre_push(app.handle(), &metadata, input).unwrap();
    }

    struct CommitFixture {
        directory: tempfile::TempDir,
    }

    impl CommitFixture {
        fn new() -> Self {
            let fixture = Self {
                directory: tempfile::tempdir().unwrap(),
            };
            fixture.git(&["init"]);
            fixture.git(&["config", "user.name", "Git Wasp Test"]);
            fixture.git(&["config", "user.email", "git-wasp@example.test"]);
            fixture.git(&["config", "core.autocrlf", "false"]);
            fixture.git(&["config", "core.eol", "lf"]);
            fixture.stage("file.txt", "initial\n");
            fixture.git(&["commit", "-m", "initial"]);
            fixture
        }

        fn path(&self) -> &Path {
            self.directory.path()
        }

        fn git_dir(&self) -> std::path::PathBuf {
            self.path().join(".git")
        }

        fn git(&self, args: &[&str]) {
            let output = Command::new("git")
                .arg("-C")
                .arg(self.path())
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn stage(&self, path: &str, contents: &str) {
            std::fs::write(self.path().join(path), contents).unwrap();
            self.git(&["add", path]);
        }

        #[cfg(unix)]
        fn install_hook(&self, name: &str, contents: &str) {
            use std::os::unix::fs::PermissionsExt;

            let path = self.git_dir().join("hooks").join(name);
            std::fs::write(&path, contents).unwrap();
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(path, permissions).unwrap();
        }

        fn head_oid(&self) -> String {
            let repo = git2::Repository::open(self.path()).unwrap();
            let oid = repo.head().unwrap().peel_to_commit().unwrap().id();
            oid.to_string()
        }

        fn is_staged(&self, path: &str) -> bool {
            let repo = git2::Repository::open(self.path()).unwrap();
            repo.status_file(Path::new(path))
                .unwrap()
                .intersects(git2::Status::INDEX_MODIFIED | git2::Status::INDEX_NEW)
        }

        fn head_file(&self, path: &str) -> String {
            let repo = git2::Repository::open(self.path()).unwrap();
            let commit = repo.head().unwrap().peel_to_commit().unwrap();
            let tree = commit.tree().unwrap();
            let entry = tree.get_path(Path::new(path)).unwrap();
            let blob = repo.find_blob(entry.id()).unwrap();
            String::from_utf8(blob.content().to_vec()).unwrap()
        }
    }

    #[cfg(unix)]
    fn run_commit_for_test(
        repo_path: &Path,
        message: &str,
        pre_commit_enabled: bool,
    ) -> anyhow::Result<String> {
        let app = tauri::test::mock_app();
        run_commit(
            app.handle(),
            repo_path,
            "commit-test",
            message,
            pre_commit_enabled,
        )
    }

    fn record_commit_events(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> Arc<Mutex<Vec<(String, serde_json::Value)>>> {
        let events = Arc::new(Mutex::new(Vec::new()));
        for event_name in [STARTED_EVENT, OUTPUT_EVENT, FINISHED_EVENT] {
            let events = Arc::clone(&events);
            app.listen(event_name, move |event| {
                events.lock().unwrap().push((
                    event_name.to_string(),
                    serde_json::from_str(event.payload()).unwrap(),
                ));
            });
        }
        events
    }

    #[cfg(unix)]
    #[test]
    fn successful_commit_emits_started_output_then_one_success() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        fixture.install_hook("pre-commit", "#!/bin/sh\nprintf 'hook output\\n'\n");
        let app = tauri::test::mock_app();
        let events = record_commit_events(&app);

        run_commit(
            app.handle(),
            fixture.path(),
            "event-success",
            "event success",
            true,
        )
        .unwrap();

        let events = events.lock().unwrap();
        assert_eq!(events.first().unwrap().0, STARTED_EVENT);
        assert!(events.iter().any(|(name, payload)| {
            name == OUTPUT_EVENT && payload["chunk"].as_str().unwrap().contains("hook output")
        }));
        let finished = events
            .iter()
            .filter(|(name, _)| name == FINISHED_EVENT)
            .collect::<Vec<_>>();
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].1["outcome"], "succeeded");
        assert_eq!(events.last().unwrap().0, FINISHED_EVENT);
    }

    #[cfg(unix)]
    #[test]
    fn post_commit_resolution_failure_emits_one_failed_terminal_event() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        fixture.install_hook(
            "post-commit",
            "#!/bin/sh\nprintf 'post output\\n'\nrm .git/HEAD\n",
        );
        let app = tauri::test::mock_app();
        let events = record_commit_events(&app);

        let error = run_commit(
            app.handle(),
            fixture.path(),
            "event-resolution-failure",
            "break head after commit",
            true,
        )
        .unwrap_err();

        assert!(
            error.to_string().contains("could not reopen repository")
                || error.to_string().contains("could not resolve HEAD"),
            "unexpected error: {error:#}"
        );
        let events = events.lock().unwrap();
        assert_eq!(events.first().unwrap().0, STARTED_EVENT);
        assert!(events.iter().any(|(name, payload)| {
            name == OUTPUT_EVENT && payload["chunk"].as_str().unwrap().contains("post output")
        }));
        let finished = events
            .iter()
            .filter(|(name, _)| name == FINISHED_EVENT)
            .collect::<Vec<_>>();
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].1["outcome"], "failed");
        assert_eq!(
            finished[0].1["summary"],
            "commit completed but repository state could not be refreshed"
        );
        assert_eq!(events.last().unwrap().0, FINISHED_EVENT);
    }

    #[cfg(unix)]
    #[test]
    fn failed_hook_emits_started_output_then_one_failed_terminal_event() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        fixture.install_hook(
            "pre-commit",
            "#!/bin/sh\nprintf 'lint failed\\n' >&2\nexit 7\n",
        );
        let app = tauri::test::mock_app();
        let events = record_commit_events(&app);

        let error = run_commit(
            app.handle(),
            fixture.path(),
            "event-hook-failure",
            "blocked",
            true,
        )
        .unwrap_err();

        assert_eq!(error.to_string(), "commit failed; review hook output");
        let events = events.lock().unwrap();
        assert_eq!(events.first().unwrap().0, STARTED_EVENT);
        assert!(events.iter().any(|(name, payload)| {
            name == OUTPUT_EVENT && payload["chunk"].as_str().unwrap().contains("lint failed")
        }));
        let finished = events
            .iter()
            .filter(|(name, _)| name == FINISHED_EVENT)
            .collect::<Vec<_>>();
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].1["outcome"], "failed");
        assert_eq!(finished[0].1["exitCode"], 1);
        assert_eq!(
            finished[0].1["summary"],
            "commit failed; review hook output"
        );
        assert_eq!(events.last().unwrap().0, FINISHED_EVENT);
    }

    #[test]
    fn unavailable_git_emits_one_actionable_failed_terminal_event() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        let app = tauri::test::mock_app();
        let events = record_commit_events(&app);

        let error = run_commit_with_program(
            app.handle(),
            fixture.path(),
            "event-unavailable-git",
            "cannot launch",
            true,
            std::ffi::OsStr::new("definitely-not-a-git-executable"),
        )
        .unwrap_err();

        assert!(error.to_string().contains("could not start hook command"));
        let events = events.lock().unwrap();
        let finished = events
            .iter()
            .filter(|(name, _)| name == FINISHED_EVENT)
            .collect::<Vec<_>>();
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].1["outcome"], "failed");
        assert_eq!(finished[0].1["summary"], "could not start git commit");
    }

    #[cfg(unix)]
    #[test]
    fn native_commit_runs_pre_commit_and_returns_head() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        fixture.install_hook(
            "pre-commit",
            "#!/bin/sh\nprintf ran > .git/pre-commit-ran\n",
        );
        let oid = run_commit_for_test(fixture.path(), "run hook", true).unwrap();
        assert_eq!(oid, fixture.head_oid());
        assert_eq!(
            std::fs::read_to_string(fixture.git_dir().join("pre-commit-ran")).unwrap(),
            "ran"
        );
    }

    #[cfg(unix)]
    #[test]
    fn failed_pre_commit_blocks_commit_and_keeps_index() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        let before = fixture.head_oid();
        fixture.install_hook(
            "pre-commit",
            "#!/bin/sh\nprintf 'lint failed\\n' >&2\nexit 7\n",
        );
        assert!(run_commit_for_test(fixture.path(), "blocked", true).is_err());
        assert_eq!(fixture.head_oid(), before);
        assert!(fixture.is_staged("file.txt"));
    }

    #[cfg(unix)]
    #[test]
    fn disabled_pre_commit_uses_no_verify() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        fixture.install_hook("pre-commit", "#!/bin/sh\nexit 9\n");
        assert!(run_commit_for_test(fixture.path(), "skip hook", false).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn pre_commit_can_change_the_index_before_commit() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "before hook\n");
        fixture.install_hook(
            "pre-commit",
            "#!/bin/sh\nprintf 'from hook\\n' > file.txt\ngit add file.txt\n",
        );
        run_commit_for_test(fixture.path(), "index update", true).unwrap();
        assert_eq!(fixture.head_file("file.txt"), "from hook\n");
    }

    #[test]
    fn invalid_utf8_is_decoded_lossily() {
        assert_eq!(decode_output(&[b'o', b'k', 0xff]), "ok\u{fffd}");
    }

    #[test]
    fn pre_push_command_uses_git_hook_run_with_direct_arguments() {
        let directory = tempfile::tempdir().unwrap();
        let stdin_path = directory.path().join("hook input");
        let command = pre_push_command(
            directory.path(),
            &stdin_path,
            "origin",
            "https://example.test/a b.git",
        );
        assert_eq!(command.get_program(), "git");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![
                std::ffi::OsStr::new("-C"),
                directory.path().as_os_str(),
                std::ffi::OsStr::new("hook"),
                std::ffi::OsStr::new("run"),
                std::ffi::OsStr::new("--ignore-missing"),
                std::ffi::OsStr::new("--to-stdin"),
                stdin_path.as_os_str(),
                std::ffi::OsStr::new("pre-push"),
                std::ffi::OsStr::new("--"),
                std::ffi::OsStr::new("origin"),
                std::ffi::OsStr::new("https://example.test/a b.git")
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn git_without_hook_run_reports_an_actionable_capability_error() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let fake_git = directory.path().join("old-git");
        std::fs::write(
            &fake_git,
            "#!/bin/sh\nprintf \"git: 'hook' is not a git command\\n\" >&2\nexit 1\n",
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&fake_git).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&fake_git, permissions).unwrap();

        let error =
            ensure_git_hook_run_available_with_program(directory.path(), fake_git.as_os_str())
                .unwrap_err();

        assert!(error
            .to_string()
            .contains("upgrade Git to run pre-push hooks"));
        assert!(!error.to_string().contains("pre-push failed"));
    }

    struct OneByteAtATime {
        bytes: std::vec::IntoIter<u8>,
    }

    impl Read for OneByteAtATime {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            match self.bytes.next() {
                Some(byte) => {
                    buffer[0] = byte;
                    Ok(1)
                }
                None => Ok(0),
            }
        }
    }

    #[test]
    fn stream_decoder_preserves_split_utf8_and_replaces_invalid_and_incomplete_bytes() {
        let (sender, receiver) = mpsc::channel();
        read_stream(
            OneByteAtATime {
                bytes: vec![b'a', 0xe2, 0x82, 0xac, 0xff, 0xe2, 0x82].into_iter(),
            },
            HookStream::Stdout,
            sender,
        );

        let text = receiver
            .into_iter()
            .map(|message| match message {
                ReaderMessage::Chunk(_, chunk) => chunk,
                ReaderMessage::Error(error) => panic!("{error}"),
            })
            .collect::<String>();
        assert_eq!(text, "a€\u{fffd}\u{fffd}");
    }

    #[test]
    fn a_repository_cannot_start_two_hook_runs() {
        let registry = RunRegistry::default();
        let first = registry.begin("/tmp/a").unwrap();
        assert_eq!(
            registry.begin("/tmp/a").unwrap_err().to_string(),
            "a hook-aware operation is already running for this repository"
        );
        assert!(registry.begin("/tmp/b").is_ok());
        drop(first);
        assert!(registry.begin("/tmp/a").is_ok());
    }

    #[test]
    fn hook_run_ids_are_unique() {
        let registry = RunRegistry::default();
        let first_id = registry.begin("/tmp/a").unwrap().run_id().to_string();
        let second_id = registry.begin("/tmp/b").unwrap().run_id().to_string();
        assert_ne!(first_id, second_id);
    }

    #[test]
    fn event_payloads_match_the_frontend_contract() {
        let started = HookStarted {
            repo_path: "/tmp/a".into(),
            run_id: "run-1".into(),
            hook: HookName::PreCommit,
            operation: "commit",
        };
        assert_eq!(
            serde_json::to_value(started).unwrap(),
            serde_json::json!({
                "repoPath": "/tmp/a",
                "runId": "run-1",
                "hook": "pre-commit",
                "operation": "commit"
            })
        );

        let output = HookOutput {
            repo_path: "/tmp/a".into(),
            run_id: "run-1".into(),
            stream: HookStream::Stderr,
            chunk: "problem".into(),
        };
        assert_eq!(
            serde_json::to_value(output).unwrap(),
            serde_json::json!({
                "repoPath": "/tmp/a",
                "runId": "run-1",
                "stream": "stderr",
                "chunk": "problem"
            })
        );

        let finished = HookFinished {
            repo_path: "/tmp/a".into(),
            run_id: "run-1".into(),
            hook: HookName::PrePush,
            outcome: HookOutcome::Failed,
            exit_code: Some(9),
            summary: "pre-push failed".into(),
        };
        assert_eq!(
            serde_json::to_value(finished).unwrap(),
            serde_json::json!({
                "repoPath": "/tmp/a",
                "runId": "run-1",
                "hook": "pre-push",
                "outcome": "failed",
                "exitCode": 9,
                "summary": "pre-push failed"
            })
        );
    }

    #[test]
    fn stream_command_child() {
        if std::env::var_os("GIT_WASP_STREAM_COMMAND_CHILD").is_none() {
            return;
        }
        let mut stdin = String::new();
        std::io::stdin().read_to_string(&mut stdin).unwrap();
        println!(
            "cwd={};stdin={stdin};unicode=€",
            std::env::current_dir().unwrap().display()
        );
        eprintln!("stderr=problem");
        std::process::exit(7);
    }

    #[test]
    fn stream_command_runs_in_caller_directory_and_streams_process_io() {
        let app = tauri::test::mock_app();
        let events = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
        for event_name in [STARTED_EVENT, OUTPUT_EVENT] {
            let events = Arc::clone(&events);
            app.listen(event_name, move |event| {
                events
                    .lock()
                    .unwrap()
                    .push((event_name.to_string(), event.payload().to_string()));
            });
        }

        let directory = tempfile::tempdir().unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .current_dir(directory.path())
            .env("GIT_WASP_STREAM_COMMAND_CHILD", "1")
            .arg("--exact")
            .arg("hook_runner::tests::stream_command_child")
            .arg("--nocapture");
        let metadata = HookRunMetadata {
            repo_path: directory.path().display().to_string(),
            run_id: "integration-run".into(),
            hook: HookName::PreCommit,
            operation: "commit",
        };

        let output = stream_command(
            app.handle(),
            &metadata,
            command,
            Some(b"from-parent".to_vec()),
        )
        .unwrap();

        assert_eq!(output.status.code(), Some(7));
        assert!(output.stdout.is_empty());
        assert!(output.stderr.is_empty());
        let events = events.lock().unwrap();
        assert_eq!(events[0].0, STARTED_EVENT);
        let output_events = events
            .iter()
            .filter(|(name, _)| name == OUTPUT_EVENT)
            .map(|(_, payload)| serde_json::from_str::<serde_json::Value>(payload).unwrap())
            .collect::<Vec<_>>();
        let stream_text = |stream| {
            output_events
                .iter()
                .filter(|event| event["stream"] == stream)
                .map(|event| event["chunk"].as_str().unwrap())
                .collect::<String>()
        };
        let stdout = stream_text("stdout");
        assert!(stdout.contains(&format!(
            "cwd={}",
            std::fs::canonicalize(directory.path()).unwrap().display()
        )));
        assert!(stdout.contains("stdin=from-parent"));
        assert!(stdout.contains("unicode=€"));
        assert!(stream_text("stderr").contains("stderr=problem"));
    }
}
