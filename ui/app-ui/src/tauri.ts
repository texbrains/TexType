// What the pages use of Tauri's global API (withGlobalTauri in app/tauri.conf.json).

export interface TauriGlobal {
  core: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> };
  event: { listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<unknown> };
}

declare global {
  interface Window {
    __TAURI__: TauriGlobal;
  }
}
