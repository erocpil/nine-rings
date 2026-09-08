export interface PasswordPrompt {
  title: string;
  description: string;
  newPassword?: boolean;
}
export class PasswordRequestCancelled extends Error {
  constructor() {
    super("已取消密码操作，数据未修改");
    this.name = "PasswordRequestCancelled";
  }
}
export interface PendingPasswordPrompt extends PasswordPrompt {
  submit: (password: string) => Promise<void>;
  cancel: () => void;
}
let listener: ((prompt: PendingPasswordPrompt | null) => void) | undefined;
let cancelCurrent: (() => void) | undefined;
export function registerPasswordPrompt(fn: (prompt: PendingPasswordPrompt | null) => void): () => void {
  listener = fn;
  return () => { cancelCurrent?.(); listener = undefined; };
}
export function requestPassword<T>(prompt: PasswordPrompt, task: (password: string) => Promise<T>): Promise<T> {
  if (!listener) return Promise.reject(new Error("密码对话框不可用，请在主窗口操作"));
  if (cancelCurrent) return Promise.reject(new Error("请先完成当前密码操作"));
  return new Promise<T>((resolve, reject) => {
    const close = () => { cancelCurrent = undefined; listener?.(null); };
    cancelCurrent = () => { close(); reject(new PasswordRequestCancelled()); };
    listener?.({ ...prompt, cancel: cancelCurrent, submit: async password => {
      const value = await task(password);
      close();
      resolve(value);
    } });
  });
}
