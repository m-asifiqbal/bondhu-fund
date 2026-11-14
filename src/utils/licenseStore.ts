import { useSyncExternalStore } from 'react';
import { licenseStatus, onLicenseChanged } from '../services/db';
import type { LicenseView } from '../types';

/** What the app assumes when it cannot ask (for example in a browser): no licence rules. */
const OFF: LicenseView = { enforced: false, configured: false, locked: false, reason: 'none', message: '', scope: null, username: '', customer: '', paidUntil: null, daysLeft: null, status: null, installId: '', lastCheckAt: null, lastError: null };

let view: LicenseView | null = null;      // null = not asked yet
const subs = new Set<() => void>();
let started = false;
const emit = () => subs.forEach(f => f());

export async function refreshLicense() {
  try { view = await licenseStatus(); } catch { view = view ?? OFF; }
  emit();
}
export function setLicenseView(v: LicenseView) { view = v; emit(); }

function start() {
  if (started) return;
  started = true;
  void refreshLicense();
  onLicenseChanged(() => { void refreshLicense(); });          // the main process says when a check changed the picture
  setInterval(() => { void refreshLicense(); }, 60_000);       // and a slow look as a safety net
  window.addEventListener('focus', () => { void refreshLicense(); });
}

/** The licence state of this copy (null until the first answer). Shared by the lock screen, the expiry notice and the sign-in gate. */
export function useLicense(): LicenseView | null {
  start();
  return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => view);
}
