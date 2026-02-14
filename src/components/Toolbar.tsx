interface Props {
  search: string;
  onSearchChange: (val: string) => void;
  density: 'default' | 'compact' | 'comfortable';
  onDensityChange: (val: 'default' | 'compact' | 'comfortable') => void;
  showGaps: boolean;
  onShowGapsChange: (val: boolean) => void;
}

export default function Toolbar({
  search,
  onSearchChange,
  density,
  onDensityChange,
  showGaps,
  onShowGapsChange,
}: Props) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 bg-[var(--surface)] flex-wrap flex-1">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Filter events (text or regex)..."
        className="flex-1 min-w-[200px] px-3 py-1.5 bg-[var(--surface2)] border border-[var(--border)] rounded-md text-[var(--text)] text-xs outline-none focus:border-[var(--accent)] transition-colors"
      />

      <select
        value={density}
        onChange={(e) => onDensityChange(e.target.value as 'default' | 'compact' | 'comfortable')}
        className="px-2.5 py-1.5 bg-[var(--surface2)] border border-[var(--border)] rounded-md text-[var(--text)] text-xs outline-none cursor-pointer"
      >
        <option value="default">Default</option>
        <option value="compact">Compact</option>
        <option value="comfortable">Comfortable</option>
      </select>

      <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={showGaps}
          onChange={(e) => onShowGapsChange(e.target.checked)}
          className="accent-[var(--accent)] cursor-pointer"
        />
        Show time gaps
      </label>
    </div>
  );
}
