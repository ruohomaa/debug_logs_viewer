interface Props {
  search: string;
  onSearchChange: (val: string) => void;
  level: string;
  onLevelChange: (val: string) => void;
  category: string;
  onCategoryChange: (val: string) => void;
  categories: string[];
  density: 'default' | 'compact' | 'comfortable';
  onDensityChange: (val: 'default' | 'compact' | 'comfortable') => void;
  showGaps: boolean;
  onShowGapsChange: (val: boolean) => void;
}

const LEVELS = ['all', 'FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINER', 'FINEST'];

export default function Toolbar({
  search,
  onSearchChange,
  level,
  onLevelChange,
  category,
  onCategoryChange,
  categories,
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
        value={level}
        onChange={(e) => onLevelChange(e.target.value)}
        className="px-2.5 py-1.5 bg-[var(--surface2)] border border-[var(--border)] rounded-md text-[var(--text)] text-xs outline-none cursor-pointer"
      >
        {LEVELS.map((l) => (
          <option key={l} value={l}>
            {l === 'all' ? 'All Levels' : l}
          </option>
        ))}
      </select>

      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="px-2.5 py-1.5 bg-[var(--surface2)] border border-[var(--border)] rounded-md text-[var(--text)] text-xs outline-none cursor-pointer"
      >
        <option value="all">All Categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

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
