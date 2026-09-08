/** Suppress repeated write failures until a write succeeds. */
export class WriteErrorReporter {
  private reportedError: string | null = null;

  report(error: Error): void {
    if (this.reportedError === error.message) return;
    this.reportedError = error.message;
    try {
      process.stderr.write(`[vestigium] write failed: ${error.message}\n`);
    } catch {
      // Logging must remain best-effort even when stderr itself is unavailable.
    }
  }

  recovered(): void {
    this.reportedError = null;
  }
}
