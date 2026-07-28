interface YearNavProps {
  years: number[];
  activeYear: number | null;
  onJump: (year: number) => void;
}

export default function YearNav({ years, activeYear, onJump }: YearNavProps) {
  if (years.length === 0) return null;
  return (
    <nav className="year-nav" aria-label="年份导航">
      {years.map((year) => (
        <button
          type="button"
          key={year}
          className={activeYear === year ? 'is-active' : ''}
          onClick={() => onJump(year)}
        >
          {year}
        </button>
      ))}
    </nav>
  );
}
