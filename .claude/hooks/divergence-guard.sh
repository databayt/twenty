#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit) hook: advisory warning when editing upstream-owned source.
# Non-blocking — it never denies the edit; it reminds you to prefer additive changes or the
# packages/twenty-api port layer, so in-place edits don't become merge debt on every /upstream-sync.
# See .claude/docs/UPSTREAM.md.
input="$(cat)"

fp="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);const t=j.tool_input||{};process.stdout.write(t.file_path||t.filePath||t.path||"")}catch(e){}})' 2>/dev/null)"

case "$fp" in
  */packages/twenty-server/src/*|*/packages/twenty-front/src/*)
    msg="⚠️ Divergence guard: ${fp} is upstream-owned source. Prefer an additive file or the packages/twenty-api port layer — in-place edits to twenty-server/twenty-front become merge debt on every /upstream-sync. See .claude/docs/UPSTREAM.md. (Advisory only; the edit is allowed.)"
    printf '%s' "$msg" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{process.stdout.write(JSON.stringify({systemMessage:s}))})' 2>/dev/null
    ;;
esac
exit 0
