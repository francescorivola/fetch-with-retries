/**
 * A lib that provides an easy way to retry http requests due to errors and rate limits.
 * It also provides an abort system to allow graceful shutdown when waiting for long retries.
 */

import { RETRY_ERROR_CODES, RETRY_STATUS_CODES } from './retry-codes';

export type Options = RequestInit & {
    timeout?: number;
    retryOptions?: Partial<RetryOptions>;
};

type RetryOptions = {
    onRetry?: (params: OnRetry) => void;
    maxRetries: number;
    initialDelay: number;
    factor: number;
    rateLimit: {
        maxRetries: number;
        maxDelay: number;
    };
};

export type OnRetry = {
    response: Response | null;
    error?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    attempt: number;
    delay: number;
    rateLimitRetry: boolean;
};

/**
 * @param url fetch url
 * @param {Options} options fetch options extended with an additional retryOptions field. The retryOptions field is optional and a default value will be applied to each subfield if not provided.
 * @returns {Promise<Response>} promise of a response
 */
export async function fetchWithRetries(
    url: string,
    options: Options
): Promise<Response> {
    const { retryOptions, timeout, ...requestInit } = options;
    const { maxRetries, initialDelay, factor, rateLimit, onRetry } =
        mergeWithDefaultOptions(retryOptions);
    const { signal } = requestInit;
    const fetchSignal = composeSignal(signal, timeout);
    const requestOptions: RequestInit = {
        ...requestInit,
        ...(fetchSignal && { signal: fetchSignal })
    };
    let attempt = 0;
    let errorRetries = 0;
    let rateLimitRetries = 0;
    let retry = false;
    let response: Response | null = null;
    let errorToRetry: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

    do {
        response = null;
        errorToRetry = null;
        attempt++;

        try {
            response = await fetch(url, requestOptions);
        } catch (e) {
            if (
                isErrorThatHaveToBeRetried(e) &&
                !hasReachedMaxRetries(errorRetries)
            ) {
                errorToRetry = e;
            } else {
                throw e;
            }
        }

        const rateLimitRetry =
            response !== null &&
            isRateLimitRetry(response) &&
            !hasReachedRateLimitMaxRetries(rateLimitRetries);
        retry =
            errorToRetry ||
            (response !== null &&
                isResponseThatHaveToBeRetried(response) &&
                !hasReachedMaxRetries(errorRetries)) ||
            rateLimitRetry;
        if (retry && !signal?.aborted) {
            let delay: number;
            if (rateLimitRetry && response !== null) {
                rateLimitRetries++;
                delay = getRateLimitDelay(response);
            } else {
                errorRetries++;
                delay = getDelay(errorRetries);
            }
            if (typeof onRetry === 'function') {
                onRetry({
                    error: errorToRetry,
                    response,
                    attempt,
                    delay,
                    rateLimitRetry
                });
            }
            await wait(delay, signal);
        }
    } while (retry && !signal?.aborted);

    signal?.throwIfAborted();

    return response!;

    function hasReachedMaxRetries(retries: number): boolean {
        return retries >= maxRetries;
    }

    function hasReachedRateLimitMaxRetries(retries: number): boolean {
        return retries >= rateLimit.maxRetries;
    }

    function getRateLimitDelay(response: Response): number {
        const retryAfter = getRetryAfterFromHeader(response);
        if (Number.isInteger(retryAfter)) {
            const delayMs = retryAfter * 1000;
            return Math.min(delayMs, rateLimit.maxDelay);
        }
        const xRateLimitReset = getXRateLimitResetFromHeader(response);
        const delayMs = xRateLimitReset * 1000 - Date.now();
        return Math.min(delayMs, rateLimit.maxDelay);
    }

    function getDelay(retries: number): number {
        return initialDelay * Math.pow(factor, retries);
    }

    function mergeWithDefaultOptions(
        options: Partial<RetryOptions> = {}
    ): RetryOptions {
        return {
            maxRetries: 3,
            initialDelay: 1000,
            factor: 2,
            rateLimit: {
                maxRetries: 10,
                maxDelay: 60_000,
                ...options.rateLimit
            },
            ...options
        };
    }

    function composeSignal(
        signal?: AbortSignal,
        timeout?: number
    ): AbortSignal | null {
        switch (true) {
            case !!signal && !timeout:
                return signal;
            case !signal && !!timeout:
                return AbortSignal.timeout(timeout);
            case !!signal && !!timeout:
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (AbortSignal as any).any([
                    signal,
                    AbortSignal.timeout(timeout)
                ]);
            default:
                return null;
        }
    }
}

function isRateLimitRetry(response: Response): boolean {
    // We check for 429 and 503 Retry-After header value if set
    // see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
    return (
        ([429, 503].includes(response.status) &&
            Number.isInteger(getRetryAfterFromHeader(response))) ||
        (response.status === 429 &&
            Number.isInteger(getXRateLimitResetFromHeader(response)))
    );
}

function getRetryAfterFromHeader(response: Response): number {
    return parseInt(response.headers.get('Retry-After') || '', 10);
}

function getXRateLimitResetFromHeader(response: Response): number {
    return parseInt(response.headers.get('X-RateLimit-Reset') || '', 10);
}

function isResponseThatHaveToBeRetried(response: Response): boolean {
    return !response.ok && RETRY_STATUS_CODES.includes(response.status);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isErrorThatHaveToBeRetried(error: any): boolean {
    return (
        (error?.cause?.code && RETRY_ERROR_CODES.includes(error.cause.code)) ||
        error.name === 'TimeoutError'
    );
}

function wait(
    durationInMilliseconds: number,
    signal?: AbortSignal
): Promise<void> {
    return new Promise<void>(resolve => {
        signal?.addEventListener('abort', handleAbort);

        const internalTimer = setTimeout(
            internalResolve,
            durationInMilliseconds
        );

        function internalResolve() {
            signal?.removeEventListener('abort', handleAbort);
            resolve();
        }

        function handleAbort() {
            signal?.removeEventListener('abort', handleAbort);
            clearTimeout(internalTimer);
            resolve();
        }
    });
}
