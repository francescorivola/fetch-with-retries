/**
 * A lib that provides an easy way to retry http requests due to errors and rate limits.
 * It also provides an abort system to allow graceful shutdown when waiting for long retries.
 */

import { RETRY_ERROR_CODES, RETRY_STATUS_CODES } from './retry-codes';

export type Options = RequestInit & {
    timeout?: number;
    retryOptions?: RetryOptions;
};

type RetryOptions = Partial<Omit<InternalRetryOptions, 'rateLimit'>> & {
    rateLimit?: Partial<RateLimitOptions>;
};

type CustomHeader = {
    header: string;
    valueType: 'wait-seconds' | 'reset-utc-epoch-seconds';
};

type RateLimitOptions = {
    maxRetries: number;
    maxDelay: number;
    customHeaders: CustomHeader[];
};

type InternalRetryOptions = {
    onRetry?: (params: OnRetry) => void;
    maxRetries: number;
    initialDelay: number;
    factor: number;
    rateLimit: RateLimitOptions;
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
    const rateLimitHeaders = getRateLimitHeaders(rateLimit);
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

        const rateLimitDelay = response ? getRateLimitDelay(response) : null;
        const rateLimitRetry =
            rateLimitDelay !== null &&
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
                delay = rateLimitDelay;
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

    function getRateLimitDelay(response: Response): number | null {
        for (const rateLimitHeader of rateLimitHeaders) {
            const { header, valueType, statusCodes } = rateLimitHeader;
            const value = getRateLimitHeaderValue(header, response);
            if (
                Number.isInteger(value) &&
                statusCodes.includes(response.status)
            ) {
                switch (valueType) {
                    case 'wait-seconds':
                        return getDelayFromSeconds(value);
                    case 'reset-utc-epoch-seconds':
                        return getDelayFromEpochSeconds(value);
                }
            }
        }
        return null;
    }

    function getDelayFromSeconds(seconds: number): number {
        return Math.min(seconds * 1000, rateLimit.maxDelay);
    }

    function getDelayFromEpochSeconds(epochSeconds: number): number {
        const delayMs = epochSeconds * 1000 - Date.now();
        return Math.min(delayMs, rateLimit.maxDelay);
    }

    function getDelay(retries: number): number {
        return initialDelay * Math.pow(factor, retries);
    }

    function mergeWithDefaultOptions(
        options: RetryOptions = {}
    ): InternalRetryOptions {
        const { rateLimit, ...restOfOptions } = options;
        return {
            maxRetries: 3,
            initialDelay: 1000,
            factor: 2,
            rateLimit: {
                maxRetries: 10,
                maxDelay: 60_000,
                customHeaders: [],
                ...rateLimit
            },
            ...restOfOptions
        };
    }

    function getRateLimitHeaders(rateLimit: RateLimitOptions) {
        return [
            {
                // We check for 429 and 503 Retry-After header value if set
                // see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
                header: 'Retry-After',
                valueType: 'wait-seconds',
                statusCodes: [429, 503]
            },
            {
                header: 'X-RateLimit-Reset',
                valueType: 'reset-utc-epoch-seconds',
                statusCodes: [429, 503]
            },
            ...rateLimit.customHeaders.map(c => ({
                ...c,
                statusCodes: [429]
            }))
        ];
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

function getRateLimitHeaderValue(header: string, response: Response): number {
    return parseInt(response.headers.get(header) || '', 10);
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
