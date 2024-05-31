export type OnRetry = {
  response: Response | null;
  error?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  attempt: number;
  delay: number;
  rateLimitRetry: boolean;
};

export type FetchWithRetries = (
  url: string,
  requestInit: RequestInit,
  options: {
    onRetry?: (params: OnRetry) => void;
  },
) => Promise<Response>;

/**
 * A lib that provides an easy way to retry http requests due to errors and rate limits.
 * It also provides an abort system to allow graceful shutdown when waiting for long retries.
 */
export function buildFetchWithRetries(options: {
  maxRetries: number;
  initialDelay: number;
  factor: number;
  rateLimit: {
    maxRetries: number;
    maxDelay: number;
  };
}): FetchWithRetries {
  const { maxRetries, initialDelay, factor, rateLimit } = options;

  /**
   * @param url fetch url
   * @param requestInit fetch request options
   * @param options retry options
   * @returns promise of a response
   */
  async function fetchWithRetries(
    url: string,
    requestInit: RequestInit,
    options: {
      onRetry?: (params: OnRetry) => void;
    } = {},
  ): Promise<Response> {
    const { onRetry } = options;
    const signal = requestInit.signal as AbortSignal;
    let attempt = 0;
    let errorRetries = 0;
    let rateLimitRetries = 0;
    let retry = false;
    let rateLimitRetry = false;
    let response: Response | null = null;
    let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

    let aborted = false;
    function setAborted() {
      aborted = true;
    }
    signal?.addEventListener("abort", setAborted);

    do {
      response = null;
      error = null;
      attempt++;

      try {
        response = await fetch(url, requestInit);
      } catch (e) {
        if ((e as { type: string }).type === "aborted") {
          // do nothing
        } else if (!hasReachedMaxRetries(errorRetries)) {
          error = e;
        } else {
          signal?.removeEventListener("abort", setAborted);
          throw e;
        }
      }

      rateLimitRetry =
        response !== null &&
        isRateLimitRetry(response) &&
        !hasReachedRateLimitMaxRetries(rateLimitRetries);
      retry =
        error ||
        (response !== null &&
          isErrorThatHaveToBeRetried(response) &&
          !hasReachedMaxRetries(errorRetries)) ||
        rateLimitRetry;

      if (retry && !aborted) {
        let delay: number;
        if (rateLimitRetry && response !== null) {
          rateLimitRetries++;
          delay = getRateLimitDelay(response);
        } else {
          errorRetries++;
          delay = getDelay(errorRetries);
        }
        if (typeof onRetry === "function") {
          onRetry({
            error,
            response,
            attempt,
            delay,
            rateLimitRetry,
          });
        }
        await wait(delay, signal);
      }
    } while (retry && !aborted);

    signal?.removeEventListener("abort", setAborted);
    if (aborted) {
      signal?.throwIfAborted();
    }

    return response as any; // TODO: fix this any
  }

  return fetchWithRetries;

  function hasReachedMaxRetries(retries: number): boolean {
    return retries >= maxRetries;
  }

  function hasReachedRateLimitMaxRetries(retries: number): boolean {
    return retries >= rateLimit.maxRetries;
  }

  function getRateLimitDelay(response: Response): number {
    const retryAfterDelay = getRetryAfterInMilliseconds(response);
    return retryAfterDelay < rateLimit.maxDelay
      ? retryAfterDelay
      : rateLimit.maxDelay;
  }

  function getDelay(retries: number): number {
    return initialDelay * Math.pow(factor, retries);
  }
}

function isRateLimitRetry(response: Response): boolean {
  // We check for 429 and 503 Retry-After header value if set
  // see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
  return (
    [429, 503].includes(response.status) &&
    Number.isInteger(getRetryAfterInSeconds(response))
  );
}

function getRetryAfterInSeconds(response: Response): number {
  return parseInt(response.headers.get("Retry-After") || "", 10);
}

function getRetryAfterInMilliseconds(response: Response): number {
  return getRetryAfterInSeconds(response) * 1000;
}

function isErrorThatHaveToBeRetried(response: Response): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(response.status);
}

function wait(
  durationInMilliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    signal?.addEventListener("abort", handleAbort);

    const internalTimer = setTimeout(internalResolve, durationInMilliseconds);

    function internalResolve() {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }

    function handleAbort() {
      signal?.removeEventListener("abort", handleAbort);
      clearTimeout(internalTimer);
      resolve();
    }
  });
}
