import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

export interface DataTableColumn<T> {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  numeric?: boolean;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  loading?: boolean;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
}

export function DataTable<T>({
  className,
  columns,
  rows,
  rowKey,
  empty,
  loading = false,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  ...props
}: DataTableProps<T>) {
  const allSelected =
    selectable && rows.length > 0 && selectedKeys?.size === rows.length;

  const toggleAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(rows.map(rowKey)));
    }
  };

  const toggleRow = (key: string) => {
    if (!onSelectionChange || !selectedKeys) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };

  if (loading) {
    return (
      <div className={cn("rounded-xl border border-line bg-surface p-5", className)} {...props}>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height="20px" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0 && empty) {
    return (
      <div className={cn("rounded-xl border border-line bg-surface", className)} {...props}>
        {empty}
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-surface", className)} {...props}>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {selectable && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-line-control accent-primary"
                    aria-label="Selecionar todos"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    col.className
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const isSelected = selectedKeys?.has(key);
              return (
                <tr
                  key={key}
                  className={cn(
                    "border-b border-line transition-colors duration-150 last:border-b-0",
                    isSelected ? "bg-info-soft" : "hover:bg-surface-hover"
                  )}
                >
                  {selectable && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(key)}
                        className="h-4 w-4 rounded border-line-control accent-primary"
                        aria-label={`Selecionar linha`}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 text-ink",
                        col.numeric && "font-mono tabular-nums",
                        col.align === "right" && "text-right",
                        col.align === "center" && "text-center",
                        col.className
                      )}
                    >
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <div className="flex flex-col sm:hidden">
        {rows.map((row) => {
          const key = rowKey(row);
          const isSelected = selectedKeys?.has(key);
          return (
            <div
              key={key}
              className={cn(
                "border-b border-line p-4 last:border-b-0",
                isSelected ? "bg-info-soft" : ""
              )}
            >
              {selectable && (
                <div className="mb-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRow(key)}
                    className="h-4 w-4 rounded border-line-control accent-primary"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {columns.map((col) => (
                  <div key={col.key} className="flex items-center justify-between">
                    <span className="text-xs text-ink-3">{col.label}</span>
                    <span className={cn("text-sm text-ink", col.numeric && "font-mono tabular-nums")}>
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

DataTable.displayName = "DataTable";