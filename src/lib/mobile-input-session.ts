/** Shared scroll arbitration. Native touch selection and IME own the viewport
 * until confirmed; only input/navigation or a shrinking keyboard may reveal. */
export class MobileInputSession {
  phase:
    | "idle"
    | "touch"
    | "reading"
    | "selection"
    | "composing"
    | "typing"
    | "navigation" = "idle";
  pending = false;
  get blocked() {
    return ["touch", "reading", "selection", "composing"].includes(this.phase);
  }
  cancel() {
    this.pending = false;
  }
  touch() {
    this.phase = "touch";
    this.cancel();
  }
  release() {
    if (this.phase === "touch") this.phase = "idle";
  }
  read() {
    this.phase = "reading";
    this.cancel();
  }
  select() {
    this.phase = "selection";
    this.cancel();
  }
  input(composing = false) {
    this.phase = composing ? "composing" : "typing";
  }
  navigate() {
    this.phase = "navigation";
  }
  blur() {
    this.phase = "idle";
    this.cancel();
  }
  request() {
    if (this.phase !== "reading" && this.phase !== "selection")
      this.pending = true;
  }
}
