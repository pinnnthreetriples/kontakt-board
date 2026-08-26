// Strict wrapper around `layout-context lint`.
// The CLI exits 0 on warnings (only errors fail it), so broken-token-ref and
// wcag-aa-contrast findings in this kit would pass silently. Here warnings
// count as failures too.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@layoutdesign/context/dist/bin/cli.js', import.meta.url));

let raw;
try {
  raw = execFileSync(process.execPath, [cli, 'lint', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (error) {
  raw = error.stdout ?? '';
  if (!raw) throw error;
}

const { issues, summary } = JSON.parse(raw);
const blocking = issues.filter((issue) => issue.severity !== 'info');
for (const issue of blocking) {
  const at = `${issue.file ?? 'layout.md'}${issue.line === undefined ? '' : `:${issue.line}`}`;
  process.stderr.write(`${issue.severity}  ${at}  ${issue.message}  (${issue.ruleId})\n`);
}
process.stdout.write(
  `layout lint: ${summary.errors} errors, ${summary.warnings} warnings, ${summary.info} info. ` +
  `${blocking.length === 0 ? 'Passed.' : 'Failed.'}\n`,
);
process.exit(blocking.length === 0 ? 0 : 1);
