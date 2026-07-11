import { toSafeSfuFailure } from "../sfu-diagnostics";

interface SfuLogger {
  warn(message: string): void;
  error(...args: unknown[]): void;
}

export interface SfuClientOptions {
  appId: string;
  secret: string;
  fetch: typeof globalThis.fetch;
  log: SfuLogger;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export class SfuClient {
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: SfuClientOptions) {
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  fetch(method: string, path: string) {
    return this.request(method, path);
  }

  async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `https://rtc.live.cloudflare.com/v1/apps/${this.options.appId}/${path}`;
    const jsonBody = body === undefined ? undefined : JSON.stringify(body);

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.options.secret}`,
        };
        if (jsonBody !== undefined)
          headers["Content-Type"] = "application/json";
        const response = await this.options.fetch(url, {
          method,
          signal: controller.signal,
          headers,
          ...(jsonBody === undefined ? {} : { body: jsonBody }),
        });
        const text = await response.text();

        if (response.ok) return JSON.parse(text) as Record<string, unknown>;
        if (response.status >= 500 && attempt === 0) {
          this.options.log.warn(
            `${method} ${path} returned ${response.status}, retrying in ${this.retryDelayMs}ms...`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelayMs),
          );
          continue;
        }

        this.options.log.error(
          "SFU request failed",
          toSafeSfuFailure({
            attempt,
            operation: `${method} ${path}`,
            requestId: response.headers.get("cf-ray"),
            status: response.status,
          }),
        );
        throw new Error(`SFU ${method} ${path} failed (${response.status})`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("SFU "))
          throw error;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`SFU ${method} ${path} failed after retry`);
  }
}
