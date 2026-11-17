// Whether overnight digests are on for this device. Turning them on shares
// the list of shows you follow with the server (it has to know what to check);
// everything else stays on the device. Off by default.

const KEY = 'pd.overnight.v1';

export function isOvernightOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setOvernightOn(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage disabled — non-fatal */
  }
}
