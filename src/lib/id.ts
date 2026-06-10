/** Generate a random application ID without binding to a runtime. */
export function genId(): string {
  return crypto.randomUUID();
}
