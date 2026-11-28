// UserPromptSubmit hook shared by Claude Code and Codex.
import fs from 'node:fs';

function currentContext(): string {
  const { activeFile } = JSON.parse(fs.readFileSync(process.env.ASTROLABE_CONTEXT_PATH!, 'utf8'));
  if (!activeFile) return 'Astrolabe has no file open in this window.';
  const label = 'Active file in this Astrolabe window: ' + JSON.stringify(activeFile);
  try {
    if (!fs.statSync(activeFile).isFile()) return label;
    const fd = fs.openSync(activeFile, 'r');
    try {
      const bytes = Buffer.alloc(12 * 1024 + 1);
      const size = fs.readSync(fd, bytes);
      const content = bytes.subarray(0, Math.min(size, bytes.length - 1));
      if (content.includes(0)) return label;
      const excerpt = new TextDecoder('utf-8', { fatal: true }).decode(content, { stream: size === bytes.length });
      return label + (size === bytes.length ? '\nBeginning of saved file:\n' : '\nSaved file contents:\n') + excerpt;
    } finally { fs.closeSync(fd); }
  } catch { return label; }
}

try {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: currentContext() } }));
} catch { /* The window may have closed while the agent was submitting. */ }
