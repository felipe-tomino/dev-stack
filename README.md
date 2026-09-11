# Development stack snapshot

This repository is a snapshot of my Apple Silicon macOS development environment. It records authored preferences and a small OpenCode integration so I can inspect or restore the setup on another machine.

It is not a package, supported installer, or reproducible machine definition. The configurations track the current behavior of their upstream tools, and anyone copying them should review every file first.

## Contents

| Path | Snapshot |
| --- | --- |
| `ghostty/` | Shell integration, click-to-move behavior, and theme |
| `herdr/` | Sidebar presentation and worktree location |
| `atuin/` | Search, workspace, AI, and daemon preferences |
| `yazi/` | Previewers, keymap, and package selections |
| `opencode/profile/` | The `ws` OCX/OpenCode profile, agents, skills, and workflow instructions |
| `opencode/tui-plugins/` | Hunk review controls for OpenCode running inside Herdr |
| `opencode/tui.jsonc` | TUI plugin registration |

Hunk is part of the stack but has no authored application configuration. The OpenCode profile includes a repository-owned Hunk launcher and constrained pair-review workflow. Credentials, histories, databases, caches, logs, sockets, backups, package-manager state, and vendor-generated files do not belong in this repository.

## Restore on a new machine

Install Ghostty, Herdr, Hunk, Atuin, OpenCode, OCX, and optionally Yazi through their normal distribution channels. This repository does not install application binaries or pin their versions.

### OpenCode and OCX

Bootstrap a profile and compose the upstream components it references:

```bash
ocx profile add ws --global
ocx registry add https://registry.kdco.dev --name kdco --profile ws
ocx add --profile ws kdco/philosophy kdco/code-review kdco/notify
```

Then copy the authored snapshot into the profile:

```bash
cp -R opencode/profile/. "$HOME/.config/opencode/profiles/ws/"
```

To use this profile by default in new shells, add this to the shell configuration. The launcher makes OCX read the stable installed profile instead of retaining an OCX temporary snapshot:

```bash
export OCX_PROFILE=ws
export OPENCODE_BIN="$HOME/.config/opencode/profiles/ws/bin/opencode-ws"
```

After changing the repository-owned profile or TUI integration, synchronize it with:

```bash
node opencode/profile-sync.mjs
```

The command makes the installed configuration and agent directory mirror the repository, deleting agent definitions and backups that are not tracked here. Model selections come from `opencode/profile/opencode.jsonc`; unrelated non-agent OCX components remain installed. Inside Herdr the command restarts idle OpenCode panes through the stable launcher and resumes their existing session IDs. Exiting OCX releases those panes' temporary snapshots. Working, blocked, current, or sessionless panes are reported and left untouched; their live snapshots are never deleted.

The snapshot records the selected primary and small models. Agents without an explicit model inherit the profile selection.

Install Herdr's vendor-managed hooks before copying the repository-owned TUI files:

```bash
herdr integration install opencode
mkdir -p "$HOME/.config/opencode/tui-plugins"
cp opencode/tui-plugins/herdr-tui.js "$HOME/.config/opencode/tui-plugins/herdr-tui.js"
cp opencode/tui-plugins/hunk-review.js "$HOME/.config/opencode/tui-plugins/hunk-review.js"
cp opencode/tui.jsonc "$HOME/.config/opencode/tui.jsonc"
```

`opencode/tui.jsonc` expects `herdr integration install opencode` to create `~/.config/opencode/herdr-tui-session.js`. Back up and merge an existing TUI configuration instead of overwriting it when the target machine is not a fresh setup.

### Application configuration

Copy the remaining files to their standard locations:

```text
ghostty/config     -> ~/.config/ghostty/config
herdr/config.toml  -> ~/.config/herdr/config.toml
atuin/config.toml  -> ~/.config/atuin/config.toml
yazi/*.toml        -> ~/.config/yazi/
```

After copying the Yazi files, run `ya pkg install` to restore the selected packages. The
`rich-preview-md` previewer is a machine-local fork and must also be available at
`~/.config/yazi/plugins/rich-preview-md.yazi/`; its implementation and Python environment are
not included in this repository.

## OpenCode workflow

The profile keeps one direct implementation owner and bounded read-only helpers:

- **Build** edits code and runs commands. It is intentionally high trust.
- **Plan** resolves consequential ambiguity and prepares durable handoffs only when needed.
- **Research** coordinates bounded evidence gathering.
- **Explore** reads the current repository only.
- **Researcher** reads local repositories and connected private sources such as GitHub, Linear, and Slack.
- **Web Researcher** uses public web sources and cannot read local or connected private sources.
- **Review** and **Reviewer** evaluate a frozen local or remote baseline with exact read-only evidence tools.

Build treats a clear low-risk request as authorization for the requested workspace edit. It asks before consequential ambiguity, destructive or irreversible work, external side effects, material architecture choices, or scope expansion. Commit, push, pull-request, and publication actions always require separate authorization. Every implementation keeps a proportionate session-local work spec; repository specification files are created only when explicitly requested.

Before publishing to a public repository, Build inspects the complete outgoing change for private or identifying material. An explicit push request covers reviewed attribution required by third-party licenses and provenance for public sources, so that attribution does not trigger a second confirmation. Unrelated personal information, including names, private identifiers or URLs, credentials, and private conversation excerpts, remains blocked until removed or explicitly resolved.

Repository-owned philosophy skills follow the nearest project contracts and patterns before proposing new abstractions or visual language. The separate **Testing Philosophy** skill guides whether and where tests add useful evidence; **TDD Seams** remains an optional workflow for observable behavior with an independent oracle.

When any primary agent produces or edits communication intended for use outside the current chat, it loads the shared **Writing** skill. The active agent keeps ownership of the underlying facts, decisions, findings, or implementation while the skill shapes that established context into ready-to-use communication.

OpenCode uses project `CLAUDE.md` as a compatibility fallback only when no applicable `AGENTS.md` exists. Profile instructions remain additive. When both project file types exist, `AGENTS.md` wins rather than merging with `CLAUDE.md`.

Local repositories, authenticated GitHub data, Linear, and Slack form the private evidence zone. Web fetches, Exa, Context7, and grep.app form the public web zone. The split prevents the public-web specialist from reading private sources directly; parent agents must still avoid copying private material into public research prompts.

### Hunk review

When OpenCode runs inside Herdr, use `<leader>shift+h` or `/hunk-review` to open the active working tree in a focused Hunk tab. The review includes staged, unstaged, and untracked changes. Use `/hunk-review-branch` to compare the current branch and working tree against the merge base of the repository's configured remote default branch. The branch command refuses to guess if zero or multiple remote defaults are configured.

Use `/review` for a conventional read-only review of staged changes, the latest commit, a revision or range, a file, or a directory. It routes through the Review agent, freezes the target, applies risk-based Standards review, and keeps Acceptance findings separate when a named source of truth exists.

For pair review, open the intended diff in Hunk and start a fresh **Review** session in the same worktree. Leave only one Hunk window open for that worktree: Review is restricted to the current repository and cannot enumerate or target sessions from sibling projects. Review can inspect the live session and discuss findings. Navigating the shared view or adding an agent comment requires confirmation; the independent **Reviewer** remains inspection-only. Source edits, destructive note operations, review reloads, and remote review submission remain unavailable to both roles.

Hunk starts its local session daemon automatically. Despite the historical `hunk mcp serve` alias and `HUNK_MCP_*` environment variable names, current Hunk versions expose agent review through `hunk session`, not MCP. Do not add the daemon to OpenCode's MCP configuration or expose it beyond loopback.

### Tool execution guard

The profile plugin in `opencode/profile/plugins/tool-execution-guard.js` constrains the initial Bash working directory to `workspace`, `app`, `functions`, `rapid-public`, or `temp`. Omitting `directory` selects the workspace root. The plugin resolves aliases to existing canonical directories, rejects symlink escapes, and blocks malformed payloads before Bash runs. Payloads that reach the pre-execution hook produce redacted diagnostics and require a fresh approved directory selection before that session's next Bash call; unrelated tools remain available.

This changes the model-facing Bash payload: use `directory: "app"` instead of `workdir: "/absolute/path/app"`. Existing calls that omit a working directory remain compatible. Raw `workdir` values are intentionally rejected. OpenCode owns schema dispatch and transcript persistence, so schema failures can occur before the guard's audit and circuit-breaker hook and may still appear as generic error parts even though command execution is prevented. The directory restriction is not a filesystem sandbox: unrestricted shell commands can still name other paths, subject to the existing agent permissions and instructions.

Connected data is sent to the configured model provider when an agent reads it. The `linear-read_*` and `slack-read_*` permission patterns assume those namespaces contain read-only tools; review the effective tool list whenever integrations change.

External local paths require permission by default, so one project does not receive access to sibling repositories or parent directories. A project can declare narrow exceptions in its own `.opencode/opencode.jsonc`; this repository allows its owned Herdr configuration, installed `ws` profile, TUI configuration, and TUI plugins. Read-only agents cannot edit files or run unrestricted shell commands. Build may edit the current project and project-specific external roots, but its unrestricted shell is a trusted capability rather than an OS-level filesystem sandbox. These are personal trust choices, not recommended defaults for an unfamiliar environment.

Run `node --test opencode/profile/permissions.test.mjs opencode/profile/profile-contracts.test.mjs` after changing profile policy, components, or project permissions.
Use `REQUIRE_OCX_RUNTIME=1` when runtime integration is required; missing OCX or OpenCode binaries then
fail instead of skipping integration checks. The suite checks global and project external roots,
read-only Git restrictions, delegation contracts, Build's trust boundary, retired primary agents,
and Web Researcher's local-data isolation.

The hybrid harness protocol in `opencode/profile/evals/` adds repeatable live prompts and a manual
scorecard for behavior that static permission assertions cannot establish. Keep actual run records,
model assignments, and transcripts outside this public snapshot.

## Local customization

Public agent files use role names only. Personal names, personas, credentials, and machine-specific secrets belong in user-local configuration, not in this snapshot. Model selections are tracked as authored preferences.

## Test the custom plugin

The custom plugins use only Node.js built-ins:

```bash
node --test opencode/profile/tool-execution-guard.test.js
node --test opencode/profile-sync.test.mjs
node --test opencode/tui-plugins/herdr-tui.test.js
node --test opencode/tui-plugins/hunk-review.test.js
```

## License

Repository-authored content is available under the MIT License. Vendored and adapted material retains its own attribution and license; see `THIRD_PARTY_NOTICES.md`.
