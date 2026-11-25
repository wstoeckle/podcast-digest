// Keep the installed app current. iOS can resume a home-screen app for days
// without reloading it, so a new release wasn't seen until the app happened to
// restart. Check for a new version whenever the app comes back to the
// foreground (and hourly while open); with registerType 'autoUpdate', the page
// reloads itself once the new version has taken over.

import { registerSW } from 'virtual:pwa-register';

const HOUR = 60 * 60 * 1000;

export function registerUpdates(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, HOUR);
    },
  });
}
