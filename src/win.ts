import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Window operations routed through async Rust commands instead of the JS
 * window API. On Windows, calling getCurrentWindow().hide()/.close()/
 * .setAlwaysOnTop() directly from the frontend deadlocks the main event loop
 * (tauri issue #4121 / #3990); async commands dispatch the op to the main
 * thread correctly. See src-tauri/src/commands.rs.
 */

const label = (): string => getCurrentWindow().label;

export function hideSelf(): Promise<void> {
  return invoke('hide_window', { label: label() });
}

export function closeSelf(): Promise<void> {
  return invoke('close_window', { label: label() });
}

export function setAlwaysOnTopSelf(value: boolean): Promise<void> {
  return invoke('set_always_on_top', { label: label(), value });
}
