# Tool Execution Safety

- For Bash, omit `directory` to run in the workspace root. When another location is necessary, use only the `workspace`, `app`, `functions`, `rapid-public`, or `temp` alias supplied by the tool schema.
- Never send `workdir`, invent or abbreviate an absolute path, modify a path copied from tool output, or use a sibling repository as a working directory.
- Submit one complete, single-purpose tool call. Do not put placeholders, unfinished prose, guessed values, or follow-up commentary in commands, paths, pull-request bodies, or other externally visible payloads.
- Treat a structured tool validation failure as a request to rebuild the call from known inputs. Do not retry by editing the malformed directory or command. For the next Bash attempt, omit `directory` or select an approved alias.
- Keep unrelated valid tools available after a malformed call; the retry restriction applies only to the rejected shell payload.
- Before creating or editing external content, assemble and review the complete final payload. Never create placeholder content with the intent to replace it later.
