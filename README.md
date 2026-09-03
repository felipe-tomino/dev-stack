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
| `opencode/tui-plugins/` | Session-fork controls for OpenCode running inside Herdr |
| `opencode/tui.jsonc` | TUI plugin registration and built-in fork keybinding |

Hunk is part of the stack but has no authored configuration. Credentials, histories, databases, caches, logs, sockets, backups, package-manager state, and vendor-generated files do not belong in this repository.

## Restore on a new machine

Install Ghostty, Herdr, Hunk, Atuin, OpenCode, OCX, and optionally Yazi through their normal distribution channels. This repository does not install application binaries or pin their versions.

### OpenCode and OCX

Bootstrap a profile and compose the upstream components it references:

```bash
ocx profile add ws --source kdco/workspace --global
ocx add --profile ws kdco/philosophy kdco/code-review kdco/notify
```

Then copy the authored snapshot into the profile:

```bash
cp -R opencode/profile/. "$HOME/.config/opencode/profiles/ws/"
```

The snapshot intentionally omits model names. Agents inherit the model configured by OpenCode or the active provider.

Install Herdr's vendor-managed hooks before copying the repository-owned TUI files:

```bash
herdr integration install opencode
mkdir -p "$HOME/.config/opencode/tui-plugins"
cp opencode/tui-plugins/session-forks.js "$HOME/.config/opencode/tui-plugins/session-forks.js"
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

After copying the Yazi files, run `ya pkg install` to restore the selected plugins.

## OpenCode workflow

The profile keeps one direct implementation owner and bounded read-only helpers:

- **Build** edits code and runs commands. It is intentionally high trust.
- **Plan** resolves consequential ambiguity and prepares durable handoffs only when needed.
- **Research** coordinates bounded evidence gathering.
- **Explore** reads the current repository only.
- **Researcher** reads local repositories and connected private sources such as GitHub, Linear, and Slack.
- **Web Researcher** uses public web sources and cannot read local or connected private sources.
- **Review** and **Reviewer** evaluate a frozen local or remote baseline with exact read-only evidence tools.
- **Workspace Manager** prepares issue worktrees without managing their implementation.
- **Writer** produces send-ready communication from read-only context.

Local repositories, authenticated GitHub data, Linear, and Slack form the private evidence zone. Web fetches, Exa, Context7, and grep.app form the public web zone. The split prevents the public-web specialist from reading private sources directly; parent agents must still avoid copying private material into public research prompts.

Connected data is sent to the configured model provider when an agent reads it. The `linear-read_*` and `slack-read_*` permission patterns assume those namespaces contain read-only tools; review the effective tool list whenever integrations change.

The profile allows external access to `~/repos/**` and `~/.herdr/worktrees/**`. Build also has unrestricted edit and shell permissions. These are personal trust choices, not recommended defaults for an unfamiliar environment.

## Local customization

Public agent files use role names only. Personal names, personas, models, and machine-specific overrides belong in the installed profile or a user-local OpenCode configuration such as `~/.config/opencode/agents/` or `OPENCODE_CONFIG_DIR`, not in this snapshot.

## Test the custom plugin

The custom plugin uses only Node.js built-ins:

```bash
node --test opencode/tui-plugins/session-forks.test.js
```

## License

Repository-authored content is available under the MIT License. Vendored and adapted material retains its own attribution and license; see `THIRD_PARTY_NOTICES.md`.
