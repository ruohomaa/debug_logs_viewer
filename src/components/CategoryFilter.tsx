import { EVENT_CATEGORIES } from '../eventCategories';

interface Props {
  readonly hiddenCategories: Set<string>;
  readonly onToggleCategory: (catId: string) => void;
  readonly onShowAll: () => void;
}

export default function CategoryFilter({ hiddenCategories, onToggleCategory, onShowAll }: Props) {
  return (
    <div className="flex items-center gap-1.5 px-5 py-1.5 bg-[var(--surface)] border-b border-[var(--border)] flex-wrap">
      <span className="text-xs text-[var(--text-dim)] mr-1">Show:</span>
      {EVENT_CATEGORIES.map((cat) => {
        const isHidden = hiddenCategories.has(cat.id);
        return (
          <button
            key={cat.id}
            onClick={() => onToggleCategory(cat.id)}
            className={`px-2 py-0.5 text-[10px] font-medium rounded-full cursor-pointer transition-all border ${
              isHidden
                ? 'border-[var(--border)] text-[var(--text-dim)] bg-transparent opacity-40 line-through'
                : 'border-transparent'
            }`}
            style={
              isHidden
                ? undefined
                : { backgroundColor: cat.color + '20', color: cat.color, borderColor: cat.color + '40' }
            }
            title={isHidden ? `Show ${cat.label}` : `Hide ${cat.label}`}
          >
            {cat.label}
          </button>
        );
      })}
      {hiddenCategories.size > 0 && (
        <button
          onClick={onShowAll}
          className="px-2 py-0.5 text-[10px] text-[var(--accent)] bg-transparent border border-[var(--border)] rounded-full cursor-pointer hover:bg-[var(--surface2)] transition-colors ml-1"
        >
          Show all
        </button>
      )}
    </div>
  );
}
