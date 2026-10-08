import { ErrorDocumentSchema } from './schemas.ts';

/**
 * A non-success response from the Ring API. The message never contains the
 * access token or a pre-signed media URL, so it is safe to log.
 */
export class RingApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly detail: string | undefined;
  readonly requestId: string | undefined;
  readonly retryAfter: string | undefined;

  constructor(
    target: string,
    status: number,
    info: { code?: string; detail?: string; requestId?: string; retryAfter?: string } = {},
  ) {
    const reason = [info.code, info.detail].filter(Boolean).join(': ');
    super(`${target} failed with HTTP ${status}${reason ? ` (${reason})` : ''}`);
    this.name = 'RingApiError';
    this.status = status;
    this.code = info.code;
    this.detail = info.detail;
    this.requestId = info.requestId;
    this.retryAfter = info.retryAfter;
  }

  /** The access token is missing, invalid or expired. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Reads Ring's JSON:API error document when there is one. Consumes the body. */
  static async fromResponse(target: string, res: Response): Promise<RingApiError> {
    let code: string | undefined;
    let detail: string | undefined;
    try {
      const parsed = ErrorDocumentSchema.safeParse(await res.json());
      if (parsed.success) {
        const first = parsed.data.errors[0];
        code = first?.code;
        detail = first?.detail ?? first?.title;
      }
    } catch {
      // Not JSON; status alone has to do.
    }
    return new RingApiError(target, res.status, {
      code,
      detail,
      requestId: res.headers.get('x-request-id') ?? undefined,
      retryAfter: res.headers.get('retry-after') ?? undefined,
    });
  }
}
