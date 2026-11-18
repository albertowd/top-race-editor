/** How the editor asks and tells (the browser's own boxes; replaced in tests). No prompt: the desktop app (Electron)
 * has none, window.prompt gives nothing back there. */
export interface Dialogs {
  alert(message: string): void;
  confirm(message: string): boolean;
}

export const browserDialogs: Dialogs = {
  alert: (m) => window.alert(m),
  confirm: (m) => window.confirm(m),
};
