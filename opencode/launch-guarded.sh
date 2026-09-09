#!/bin/sh

set -eu

unset OCX_CONTEXT
unset OPENCODE_CONFIG_CONTENT
export OPENCODE_DISABLE_PROJECT_CONFIG=true
export OPENCODE_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/profiles/ws-guarded"

if [ ! -d "$OPENCODE_CONFIG_DIR" ]; then
	printf 'Guarded profile not found: %s\n' "$OPENCODE_CONFIG_DIR" >&2
	exit 1
fi

exec opencode "$@"
