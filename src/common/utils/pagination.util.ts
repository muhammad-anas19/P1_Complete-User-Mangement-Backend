// Matches frontend/src/types/index.ts's PaginatedResponse<T> exactly — field
// names (`limit`, not `pageSize`) and all fields always present, never
// optional, even when `data` is empty. See docs/architecture.md Section 5.
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export function getSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data,
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
