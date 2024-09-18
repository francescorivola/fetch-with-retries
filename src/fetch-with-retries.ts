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
            return getDelayFromSeconds(retryAfter);
        }
        const xRateLimitReset = getXRateLimitResetFromHeader(response);
        if (Number.isInteger(xRateLimitReset)) {
            return getDelayFromEpochSeconds(xRateLimitReset);
        }
        for (const customHeader of rateLimit.customHeaders) {
            const { header, valueType } = customHeader;
            const value = getRateLimitHeaderValue(header, response);
            if (!Number.isInteger(value)) {
                continue;
            }
            switch (valueType) {
                case 'wait-seconds':
                    return getDelayFromSeconds(value);
                case 'reset-utc-epoch-seconds':
                    return getDelayFromEpochSeconds(value);
                default:
                    throw new Error(`Unsupported valueType: ${valueType}`);
            }
        }
        throw new Error('No valid rate limit header found');
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

    function isRateLimitRetry(response: Response): boolean {
        // We check for 429 and 503 Retry-After header value if set
        // see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
        return (
            ([429, 503].includes(response.status) &&
                hasRetryAfterHeader(response)) ||
            (response.status === 429 && hasXRateLimitResetHeader(response)) ||
            rateLimit.customHeaders.some(({ header }) =>
                hasCustomHeader(header, response)
            )
        );
    }
}

function hasCustomHeader(header: string, response: Response): boolean {
    return Number.isInteger(getRateLimitHeaderValue(header, response));
}

function hasXRateLimitResetHeader(response: Response): boolean {
    return Number.isInteger(getXRateLimitResetFromHeader(response));
}

function hasRetryAfterHeader(response: Response): boolean {
    return Number.isInteger(getRetryAfterFromHeader(response));
}

function getRetryAfterFromHeader(response: Response): number {
    return getRateLimitHeaderValue('Retry-After', response);
}

function getXRateLimitResetFromHeader(response: Response): number {
    return getRateLimitHeaderValue('X-RateLimit-Reset', response);
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
