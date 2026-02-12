export const LOG_COLORS = [
  '#6c8cff', '#4ecdc4', '#ff6b6b', '#ffd93d', '#c084fc',
  '#f472b6', '#fb923c', '#34d399', '#60a5fa', '#a78bfa',
  '#f87171', '#38bdf8', '#facc15', '#e879f9', '#2dd4bf',
];

export function getLevelColor(level: string): string {
  switch (level) {
    case 'FATAL': return '#ff4444';
    case 'ERROR': return '#ff6b6b';
    case 'WARN': return '#ffd93d';
    case 'INFO': return '#6c8cff';
    case 'FINE':
    case 'FINER':
    case 'FINEST':
    case 'DEBUG':
    default: return '#8b90a0';
  }
}
