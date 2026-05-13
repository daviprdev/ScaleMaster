const raw = (process.env.PYTHON_SERVER_URL ?? "").trim().replace(/\/$/, "");
const SERVER_URL = raw && !raw.startsWith("http") ? `https://${raw}` : raw;
const SERVER_SECRET = process.env.PYTHON_SERVER_SECRET ?? "";

export function hasPythonServer(): boolean {
  return !!SERVER_URL;
}

export async function callPythonServer<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${SERVER_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER_SECRET ? { "x-api-key": SERVER_SECRET } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json() as T & { detail?: string; error?: string };

  if (!res.ok) {
    const msg = data.detail ?? data.error ?? "Erro no servidor Python.";
    const err = new Error(msg) as Error & { status: number };
    err.status = res.status;
    throw err;
  }

  return data;
}
