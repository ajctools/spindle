export const seenKey = 'spindle-eyewall-seen-at';
export const autoRefreshKey = 'spindle-eyewall-feed-auto';
export const refreshInterval = 15 * 60_000;

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

const seenTime = () => Number(read(seenKey)) || 0;

export function unreadReports(reports) {
  const seen = seenTime();
  return reports.filter(report => Date.parse(report.firstSeenAt) > seen).length;
}

export function seeReports(reports) {
  const seen = seenTime();
  const newest = reports.reduce((latest, report) => Math.max(latest, Date.parse(report.firstSeenAt) || 0), seen);
  if (newest > seen) write(seenKey, String(newest));
}

export const autoRefreshEnabled = () => read(autoRefreshKey) === 'true';
export const setAutoRefresh = enabled => write(autoRefreshKey, String(enabled));

export function refreshIsDue(snapshot, now = Date.now()) {
  return !snapshot.readOnly && !snapshot.busy && !snapshot.triaging &&
    (!snapshot.lastAttempt || now - Date.parse(snapshot.lastAttempt) >= refreshInterval);
}
