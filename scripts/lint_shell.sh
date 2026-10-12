#!/bin/bash
#
# Checks every shell script in the repository against Google's Shell Style
# Guide (#135): ShellCheck with the checks in .shellcheckrc, shfmt with the
# settings in .editorconfig, and, in awk, the rules neither tool checks: the
# shebang, the file name, 80 columns, and 100 lines.
set -u

readonly MAX_COLUMNS=80
readonly MAX_LINES=100

# LINT_SHELL_ROOT: the repository to lint; this one by default. The test sets
# it, so the script runs from where it lives and its coverage is recorded.
cd "${LINT_SHELL_ROOT:-$(dirname "$0")/..}" || exit 1
LISTING="$(git ls-files --cached --others --exclude-standard '*.sh')" || exit 1
readonly LISTING
FILES=()
while IFS= read -r file; do
  FILES+=("${file}")
done <<<"${LISTING}"
readonly FILES

status=0
shellcheck "${FILES[@]}" || status=1
shfmt --diff "${FILES[@]}" || status=1
awk -v max_columns="${MAX_COLUMNS}" -v max_lines="${MAX_LINES}" '
  function report(line, message) {
    printf "%s:%d: %s\n", FILENAME, line, message > "/dev/stderr"
    bad = 1
  }
  FNR == 1 && $0 != "#!/bin/bash" {
    report(1, "start with #!/bin/bash")
  }
  FNR == 1 && FILENAME !~ /(^|\/)[a-z0-9_]+\.sh$/ {
    report(1, "name the file in lowercase, with underscores")
  }
  length > max_columns {
    report(FNR, "over " max_columns " columns")
  }
  FNR == max_lines + 1 {
    report(FNR, "over " max_lines " lines: rewrite it in another language")
  }
  END { exit bad }
' "${FILES[@]}" || status=1
exit "${status}"
