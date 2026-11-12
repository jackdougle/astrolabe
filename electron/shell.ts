// zsh integration. Astrolabe points ZDOTDIR at a directory holding these shims; each
// one sources the user's own startup file, and .zshrc then adds the hooks that
// tell the app where each command starts and ends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ZSHENV = `
if [[ -f "$ASTROLABE_USER_ZDOTDIR/.zshenv" && "$ASTROLABE_USER_ZDOTDIR" != "$ASTROLABE_ZDOTDIR" ]]; then
  ZDOTDIR="$ASTROLABE_USER_ZDOTDIR"
  . "$ASTROLABE_USER_ZDOTDIR/.zshenv"
  ASTROLABE_USER_ZDOTDIR="$ZDOTDIR"
  ZDOTDIR="$ASTROLABE_ZDOTDIR"
fi
`;

const ZPROFILE = `
if [[ -o login && -f "$ASTROLABE_USER_ZDOTDIR/.zprofile" ]]; then
  ZDOTDIR="$ASTROLABE_USER_ZDOTDIR"
  . "$ASTROLABE_USER_ZDOTDIR/.zprofile"
  ZDOTDIR="$ASTROLABE_ZDOTDIR"
fi
`;

const ZSHRC = `
# ASTROLABE_PROMPT=own: Astrolabe draws the prompt. ASTROLABE_PROMPT=native: your prompt (theme) is kept.
if [[ "$ASTROLABE_PROMPT" == own ]]; then
  # Powerlevel10k's instant prompt has nothing to show when the app draws the prompt.
  typeset -gi __p9k_instant_prompt_disabled=1
fi
if [[ -f "$ASTROLABE_USER_ZDOTDIR/.zshrc" ]]; then
  ZDOTDIR="$ASTROLABE_USER_ZDOTDIR"
  . "$ASTROLABE_USER_ZDOTDIR/.zshrc"
  ZDOTDIR="$ASTROLABE_ZDOTDIR"
fi

__astrolabe_b64() { builtin print -rn -- "$1" | command base64 | command tr -d '\\n' }

# Runs first among precmd hooks so $? is still the command's exit status.
__astrolabe_precmd_first() {
  local ret=$?
  builtin printf '\\e]7777;precmd;%s;%s\\a' "$ret" "$(__astrolabe_b64 "$PWD")"
  typeset -gi __astrolabe_prompting=1
  return $ret
}
__astrolabe_preexec() {
  typeset -gi __astrolabe_prompting=0
  builtin printf '\\e[0m\\e]7777;preexec;%s\\a' "$(__astrolabe_b64 "$1")"
}
# Keys typed while a command ran are still waiting when the next prompt's line editor starts. The app's input
# owns typing, so they are passed to it instead of being let into this line, where they could not be edited.
__astrolabe_typeahead() {
  (( __astrolabe_prompting )) || return 0
  local typed= k
  while (( PENDING > 0 && \${#typed} < 4096 )) && builtin read -k 1 k 2>/dev/null; do typed+=$k; done
  [[ -n "$typed" ]] && builtin printf '\\e]7777;typed;%s\\a' "$(__astrolabe_b64 "$typed")"
  return 0
}
precmd_functions=(__astrolabe_precmd_first \${precmd_functions:#__astrolabe_precmd_*})
preexec_functions=(\${preexec_functions:#__astrolabe_preexec} __astrolabe_preexec)

if [[ "$ASTROLABE_PROMPT" == own ]]; then
  # Powerlevel10k re-asserts its prompt on every command; switch it off for this shell only.
  if (( $+functions[prompt_powerlevel9k_teardown] )); then
    prompt_powerlevel9k_teardown 2>/dev/null
  fi
  # Runs last so it wins over prompt themes.
  __astrolabe_precmd_last() {
    PROMPT=$'\\n\\n%{\\e]7777;prompt\\a%}'
    RPROMPT=''
  }
  precmd_functions+=(__astrolabe_precmd_last)
  autoload -Uz add-zle-hook-widget 2>/dev/null && add-zle-hook-widget line-init __astrolabe_typeahead
  zle_highlight=(\${zle_highlight:#(default|paste):*} default:bold paste:none)
  setopt PROMPT_CR PROMPT_SP PROMPT_PERCENT
else
  # Your prompt stays. Tell the app when the line editor is ready, so it can put its input at the cursor.
  __astrolabe_line_init() { __astrolabe_typeahead; builtin printf '\\e]7777;input\\a' }
  autoload -Uz add-zle-hook-widget 2>/dev/null && add-zle-hook-widget line-init __astrolabe_line_init
  zle_highlight=(\${zle_highlight:#(default|paste):*} default:bold paste:none)
fi
export ASTROLABE_SHELL_INTEGRATION=1
`;

const ZLOGIN = `
if [[ -o login && -f "$ASTROLABE_USER_ZDOTDIR/.zlogin" ]]; then
  ZDOTDIR="$ASTROLABE_USER_ZDOTDIR"
  . "$ASTROLABE_USER_ZDOTDIR/.zlogin"
fi
# Child shells should start the user's way, not through these shims.
if [[ -n "$ASTROLABE_ORIG_ZDOTDIR" ]]; then ZDOTDIR="$ASTROLABE_ORIG_ZDOTDIR"; else unset ZDOTDIR; fi
`;

export function installZshIntegration(configDir: string): string {
  const dir = path.join(configDir, 'shell', 'zsh');
  fs.mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    '.zshenv': ZSHENV,
    '.zprofile': ZPROFILE,
    '.zshrc': ZSHRC,
    '.zlogin': ZLOGIN,
  };
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    const next = `# Written by Astrolabe on launch. Edits are overwritten.\n${body}`;
    let prev = '';
    try { prev = fs.readFileSync(file, 'utf8'); } catch {}
    if (prev !== next) fs.writeFileSync(file, next);
  }
  return dir;
}

// Markers an agent session leaves in its children's environment. If Astrolabe is launched from inside
// such a session (or from a terminal running one), passing them on would make every tool started in
// Astrolabe think it is a nested child: Claude Code, for one, then refuses to save transcripts.
// Settings a user puts in their own shell startup files are unaffected, since the shell sets those itself.
const SESSION_MARKER = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(CHILD_SESSION|ENTRYPOINT|EXECPATH|VERSION|SSE_PORT|MESSAGING_.+|SESSION_.+|PARENT_.+|AGENT_.+))$/;
export function stripSessionMarkers(env: NodeJS.ProcessEnv) {
  for (const k of Object.keys(env)) if (SESSION_MARKER.test(k)) delete env[k];
  return env;
}

export function shellEnv(shell: string, integrationDir: string | null, prompt: 'own' | 'native' = 'native'): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = stripSessionMarkers({ ...process.env });
  for (const k of Object.keys(env)) {
    if (k.startsWith('ELECTRON_') || k.startsWith('ASTROLABE_DEV') || k === 'NODE_OPTIONS') delete env[k];
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'Astrolabe';
  env.TERM_PROGRAM_VERSION = '0.1.0';
  if (!env.LANG) env.LANG = 'en_US.UTF-8';
  // Astrolabe handles OSC 8 links, so programs that check (Claude Code among them) can send real file links.
  if (env.FORCE_HYPERLINK === undefined) env.FORCE_HYPERLINK = '1';
  if (integrationDir && path.basename(shell) === 'zsh') {
    env.ASTROLABE_ORIG_ZDOTDIR = process.env.ZDOTDIR ?? '';
    env.ASTROLABE_USER_ZDOTDIR = process.env.ZDOTDIR || os.homedir();
    env.ASTROLABE_ZDOTDIR = integrationDir;
    env.ZDOTDIR = integrationDir;
    env.ASTROLABE_PROMPT = prompt;
  }
  return env;
}
