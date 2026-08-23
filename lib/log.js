// Stderr-only logging. STDOUT IS RESERVED for the product digest — nothing in
// this module may ever write to stdout, so every level here writes to
// process.stderr directly rather than console.log/console.error (which can be
// patched or redirected in ways that don't hold that line).

/**
 * @param {{ quiet?: boolean }} [opts]
 * @returns {{ info: Function, warn: Function, error: Function, failures: string[] }}
 */
export function makeLogger({ quiet = false } = {}) {
  const failures = [];

  function line(level, msg, ...rest) {
    const parts = [msg, ...rest].map(render);
    process.stderr.write(`${level}: ${parts.join(' ')}\n`);
  }

  function render(v) {
    if (v instanceof Error) {
      // Message on the marker line, stack indented on the line(s) after so
      // multi-line stacks stay visually attached to the log entry that caused them.
      const stack = v.stack ? `\n${indent(v.stack)}` : '';
      return `${v.message}${stack}`;
    }
    return typeof v === 'string' ? v : String(v);
  }

  function indent(text) {
    return String(text)
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n');
  }

  return {
    failures,
    info(msg, ...rest) {
      if (quiet) return;
      line('info', msg, ...rest);
    },
    warn(msg, ...rest) {
      line('warn', msg, ...rest);
    },
    error(msg, ...rest) {
      line('error', msg, ...rest);
      // Track the concise string form (no stack) so callers can summarise
      // degraded sources in a short list at the end of a run.
      failures.push(msg instanceof Error ? msg.message : String(msg));
    },
  };
}
