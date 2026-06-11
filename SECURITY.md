# Security Policy

## Reporting A Security Issue

Please do not open public issues that include secrets, private transcripts, local session files, or personally identifying filesystem paths.

For now, report security concerns privately to the project maintainer. Add a private contact method here before the first public release.

## Local Data Boundaries

Aivatar is designed as a local desktop companion. Its status bridge binds to `127.0.0.1` by default and is intended for same-machine integrations only.

Agent integrations can read local status/session metadata from tools such as Codex Desktop or Claude Code. Treat those local files as sensitive. Do not attach raw rollout JSONL files, Claude transcripts, save files, or temporary learning-context files to public issues.

## Temporary Files

Aivatar may write temporary operational files under the system temp directory, including bridge state, session helper records, task prompt copies, avatar state snapshots, and learning context digests. These files should not contain raw secrets, but they may still reveal local workflow context.

## Supported Versions

Security support starts with the first public preview release. Until then, this repository should be treated as pre-release software.
