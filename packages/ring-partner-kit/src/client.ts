import type { z } from 'zod';
import { RingApiError } from './errors.ts';
import {
  DeviceListSchema,
  DeviceStatusDocumentSchema,
  HistoryPageSchema,
  type DeviceList,
  type DeviceStatus,
  type HistoryEvent,
  type HistoryPage,
} from './schemas.ts';

export const RING_API_BASE_URL = 'https://api.amazonvision.com';

export type AccessTokenSource = string | (() => string | Promise<string>);

export interface RingClientOptions {
  /** A bearer access token, or a function returning the current one (for refresh flows). */
  accessToken: AccessTokenSource;
  baseUrl?: string;
  /** Injected for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected for tests. Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** How many times to retry a `429` before giving up. Default 5. */
  maxRetries?: number;
}

export type DeviceInclude = 'status' | 'capabilities' | 'location' | 'configurations';

export interface HistoryQuery {
  /** Filters such as `motion.human` or `ding`. Combined with OR by Ring. */
  eventTypes?: string[];
  /** Cursor taken from a previous page's `links.next`. */
  pageKey?: string;
}

export type ImageDownloadRequest =
  | { type: 'at_timestamp'; timestamp: number; imageOptions?: ImageOptions }
  | { type: 'latest_in_range'; startTimestamp: number; endTimestamp?: number; imageOptions?: ImageOptions };

export interface ImageOptions {
  format?: 'jpeg' | 'png';
  resolution?: { width: number; height: number };
}

/** An image held in memory. The kit never writes media anywhere. */
export interface RingImage {
  bytes: Uint8Array;
  contentType: string | undefined;
  /** Epoch milliseconds of the returned frame, from `X-Media-Timestamp`. */
  mediaTimestamp: number | undefined;
  /** `recording` or `snapshot`, from `X-Media-Origin`. */
  mediaOrigin: string | undefined;
}

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Delay before retrying a `429`. Honours `Retry-After` (seconds or HTTP date);
 * otherwise backs off exponentially from one second.
 */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - now, 0), MAX_BACKOFF_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Finds the `included` resource a device's relationship points at, if it was requested. */
export function findIncluded(
  list: DeviceList,
  device: DeviceList['data'][number],
  relationship: string,
): NonNullable<DeviceList['included']>[number] | undefined {
  const ref = device.relationships?.[relationship]?.data;
  if (!ref) return undefined;
  return list.included?.find((r) => r.type === ref.type && r.id === ref.id);
}

/** A thin, typed client for the Ring Partner API over plain `fetch`. Server-side only. */
export class RingClient {
  readonly #accessToken: AccessTokenSource;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxRetries: number;

  constructor(options: RingClientOptions) {
    this.#accessToken = options.accessToken;
    this.#baseUrl = options.baseUrl ?? RING_API_BASE_URL;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#maxRetries = options.maxRetries ?? 5;
  }

  /**
   * Sends an authenticated request and returns the raw response. Retries `429`s;
   * every other status is returned as is. `path` is relative to the API base URL.
   */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path, this.#baseUrl);
    for (let attempt = 0; ; attempt++) {
      const token =
        typeof this.#accessToken === 'function' ? await this.#accessToken() : this.#accessToken;
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      if (!headers.has('accept')) headers.set('accept', 'application/json');

      const res = await this.#fetch(url, { ...init, headers });
      if (res.status !== 429 || attempt >= this.#maxRetries) return res;
      await res.body?.cancel();
      await this.#sleep(retryDelayMs(res.headers.get('retry-after'), attempt));
    }
  }

  async listDevices(include: DeviceInclude[] = []): Promise<DeviceList> {
    const query = include.length ? `?include=${include.join(',')}` : '';
    return this.#getJson(`/v1/devices${query}`, DeviceListSchema);
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    const doc = await this.#getJson(
      `/v1/devices/${encodeURIComponent(deviceId)}/status`,
      DeviceStatusDocumentSchema,
    );
    return doc.data;
  }

  /** One page of event history, newest first. */
  async getHistoryPage(deviceId: string, query: HistoryQuery = {}): Promise<HistoryPage> {
    const params = new URLSearchParams();
    if (query.eventTypes?.length) params.set('event_types', query.eventTypes.join(','));
    if (query.pageKey) params.set('page[key]', query.pageKey);
    const qs = params.size ? `?${params}` : '';
    return this.#getJson(
      `/v1/history/devices/${encodeURIComponent(deviceId)}/events${qs}`,
      HistoryPageSchema,
    );
  }

  /**
   * Walks event history newest first, following `links.next`. Stops on an empty
   * page, since Ring can return a `next` link alongside no data.
   */
  async *iterateHistory(deviceId: string, query: Omit<HistoryQuery, 'pageKey'> = {}): AsyncGenerator<HistoryEvent> {
    let pageKey: string | undefined;
    for (;;) {
      const page = await this.getHistoryPage(deviceId, { ...query, pageKey });
      if (page.data.length === 0) return;
      yield* page.data;
      const next = page.links?.next;
      if (!next) return;
      const nextKey = new URL(next, this.#baseUrl).searchParams.get('page[key]');
      if (!nextKey || nextKey === pageKey) return;
      pageKey = nextKey;
    }
  }

  /**
   * Asks Ring for an existing image and returns the pre-signed download URL from
   * the `303` response. Ring does not capture a new frame; with no media in the
   * window the follow-up download fails with `416`. Treat the URL as a secret.
   */
  async requestImageDownload(deviceId: string, request: ImageDownloadRequest): Promise<URL> {
    const target = `POST /v1/devices/{id}/media/image/download`;
    const res = await this.request(`/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(imageDownloadBody(request)),
      redirect: 'manual',
    });
    const location = res.headers.get('location');
    if (res.status === 303 && location) {
      await res.body?.cancel();
      return new URL(location, this.#baseUrl);
    }
    if (res.ok) {
      await res.body?.cancel();
      throw new RingApiError(target, res.status, { detail: 'expected a 303 redirect to the media URL' });
    }
    throw await RingApiError.fromResponse(target, res);
  }

  /** Downloads an image into memory using the two-step pre-signed URL flow. */
  async downloadImage(deviceId: string, request: ImageDownloadRequest): Promise<RingImage> {
    const mediaUrl = await this.requestImageDownload(deviceId, request);
    // The pre-signed URL carries its own credentials; the bearer token must not be sent.
    const res = await this.#fetch(mediaUrl);
    if (!res.ok) throw await RingApiError.fromResponse('GET pre-signed media URL', res);
    const timestamp = Number(res.headers.get('x-media-timestamp'));
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? undefined,
      mediaTimestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined,
      mediaOrigin: res.headers.get('x-media-origin') ?? undefined,
    };
  }

  async #getJson<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
    const res = await this.request(path);
    if (!res.ok) throw await RingApiError.fromResponse(`GET ${redactIds(path)}`, res);
    return schema.parse(await res.json());
  }
}

function imageDownloadBody(request: ImageDownloadRequest): Record<string, unknown> {
  const options = request.imageOptions && {
    format: request.imageOptions.format,
    resolution: request.imageOptions.resolution,
  };
  return request.type === 'at_timestamp'
    ? { type: request.type, timestamp: request.timestamp, image_options: options }
    : {
        type: request.type,
        start_timestamp: request.startTimestamp,
        end_timestamp: request.endTimestamp,
        image_options: options,
      };
}

/** Keeps error messages short and generic: device IDs become `{id}`, query strings are dropped. */
function redactIds(path: string): string {
  return path.split('?')[0]!.replace(/\/devices\/[^/]+/g, '/devices/{id}');
}
