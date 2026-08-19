import { fetch as undiciFetch } from "undici";

export function hasPythonServer(): boolean {
  return !!process.env.PYTHON_SERVER_URL;
}

function serverUrl(): string {
  const raw = process.env.PYTHON_SERVER_URL!;
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

export async function callPythonServer<T>(
  endpoint: string,
  body: unknown,
  timeoutMs = 45_000,
): Promise<T> {
  const res = await undiciFetch(`${serverUrl()}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.PYTHON_SERVER_SECRET
        ? { Authorization: `Bearer ${process.env.PYTHON_SERVER_SECRET}` }
        : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`python-server ${endpoint}: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}
