export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch('/api/v1/' + path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body && typeof options.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  })
  const data = await response.json()
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error?.code || 'ERROR',
      data.error?.message || 'Request failed.',
    )
  return data as T
}
export function post<T>(path: string, data: unknown = {}) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(data) })
}
