#!/bin/bash
# PostToolUse hook (Edit|Write): typecheck + lint the workspace containing the
# edited file. Feedback-only — exit 2 feeds errors back to the agent so it
# self-corrects; it never blocks the edit or the session.

input=$(cat)

file_path=$(printf '%s' "$input" | node -e "
let d='';
process.stdin.on('data', c => d += c).on('end', () => {
  try { console.log(JSON.parse(d).tool_input.file_path || ''); } catch {}
});" 2>/dev/null)

[ -n "$file_path" ] || exit 0

# Only TypeScript sources trigger a check.
case "$file_path" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Map the file to its workspace package.
case "$file_path" in
  */apps/api/*)       pkg="@leksis/api" ;;
  */apps/web/*)       pkg="@leksis/web" ;;
  */packages/types/*) pkg="@leksis/types" ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# Turbo builds upstream deps (e.g. @leksis/types) before typechecking and
# caches everything, so repeat runs are fast.
output=$(npx turbo run typecheck lint --filter="$pkg" --output-logs=errors-only 2>&1)
status=$?

if [ $status -ne 0 ]; then
  {
    echo "Verification failed for $pkg after editing $file_path."
    echo "Fix these before continuing:"
    printf '%s\n' "$output" \
      | grep -vE '^\s*$|npm error|MODULE_TYPELESS|Reparsing as ES module|To eliminate this warning|--trace-warnings|^ *• |cache miss|cache hit|Remote caching|Tasks:|Cached:|Time:|turbo [0-9]' \
      | head -40
  } >&2
  exit 2
fi

exit 0
