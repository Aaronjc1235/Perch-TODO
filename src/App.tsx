import { useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import MainPanel from './windows/MainPanel';
import StickyNote from './windows/StickyNote';
import OverlayReminder from './windows/OverlayReminder';
import MiniWidget from './windows/MiniWidget';

/**
 * Single bundle, three window types — routed by the window's label:
 *   main           → day panel
 *   sticky-<id>    → sticky note for task <id>
 *   overlay-<id>   → reminder overlay for task <id>
 */
export default function App() {
  const label = useMemo(() => getCurrentWindow().label, []);

  if (label === 'mini') {
    return <MiniWidget />;
  }
  if (label.startsWith('sticky-')) {
    return <StickyNote id={Number(label.slice('sticky-'.length))} />;
  }
  if (label.startsWith('overlay-')) {
    return <OverlayReminder id={Number(label.slice('overlay-'.length))} />;
  }
  return <MainPanel />;
}
