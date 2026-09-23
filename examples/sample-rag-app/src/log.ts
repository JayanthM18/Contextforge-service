/** Structured logs on stderr. stdout is left clean for anything piping output. */

export function log(message: string, fields: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ message, ...fields })}\n`);
}
