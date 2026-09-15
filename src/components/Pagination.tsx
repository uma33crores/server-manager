import { ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export default function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);

  const pageNumbers: number[] = [];
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  const endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }
  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i);
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border">
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-muted">
          Showing {start}-{end} of {total} {total === 1 ? 'port' : 'ports'}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="filter-select py-1 text-sm min-w-[60px]"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Previous"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {pageNumbers.map((p) => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`min-w-[32px] h-8 px-2 rounded-lg text-sm font-medium transition-colors ${
              p === currentPage
                ? 'bg-sky-500 text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Next"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
