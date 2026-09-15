import type { ReactNode } from 'react';

type Variant = 'gray' | 'green' | 'yellow' | 'red' | 'blue' | 'purple';

const variants: Record<Variant, string> = {
  gray: 'bg-surface-hover text-text-secondary border-border',
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  yellow: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
  blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
  purple: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
};

export default function Badge({
  children,
  variant = 'gray',
}: {
  children: ReactNode;
  variant?: Variant;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${variants[variant]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, Variant> = {
    Running: 'green',
    'In Setup': 'yellow',
    Stopped: 'gray',
    Archived: 'gray',
    available: 'gray',
    reserved: 'yellow',
    assigned: 'green',
    not_started: 'gray',
    in_progress: 'yellow',
    completed: 'green',
    blocked: 'red',
    testing: 'blue',
    staging: 'yellow',
    production: 'green',
  };
  const display: Record<string, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    available: 'Available',
    reserved: 'Reserved',
    assigned: 'Assigned',
    testing: 'Testing',
    staging: 'Staging',
    production: 'Production',
  };
  return <Badge variant={map[status] ?? 'gray'}>{display[status] ?? status}</Badge>;
}
