/** Thrown by calculation stubs that the calc agent has not implemented yet. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`);
    this.name = 'NotImplementedError';
  }
}
