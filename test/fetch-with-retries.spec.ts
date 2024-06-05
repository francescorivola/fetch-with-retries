import * as nock from 'nock';
import { describe, beforeEach, afterEach, test } from 'node:test';
import { equal, deepStrictEqual } from 'node:assert';
import { fetchWithRetries } from '../src/index';

const retryStatusCodes = [408, 425, 429, 500, 502, 503, 504];

class FetchError extends Error {
    public readonly cause: { code: string };

    constructor(code: string) {
        super('fetch failed');
        this.cause = { code };
    }
}

describe('fetch-with-retries', async () => {
    await beforeEach(() => {
        nock.disableNetConnect();
    });

    await afterEach(() => {
        nock.cleanAll();
        nock.enableNetConnect();
    });

    await test('should return the response if ok', async () => {
        const nockScope = nock('https://test.com')
            .get('/test')
            .reply(200, { message: 'ok' });
        let retries = 0;

        const response = await fetchWithRetries('https://test.com/test', {
            method: 'GET',
            retryOptions: {
                onRetry: () => {
                    retries++;
                }
            }
        });

        equal(retries, 0, 'retries');
        equal(response.ok, true);
        const body = await response.json();
        deepStrictEqual(body, { message: 'ok' });
        equal(nockScope.isDone(), true);
    });

    await test('should return the response if not ok and cannot be retried', async () => {
        const nockScope = nock('https://test.com')
            .get('/test')
            .reply(400, { message: 'bad request' });
        let retries = 0;

        const response = await fetchWithRetries('https://test.com/test', {
            method: 'GET',
            retryOptions: {
                onRetry: () => {
                    retries++;
                },
                maxRetries: 1
            }
        });

        equal(retries, 0, 'retries');
        equal(response.ok, false);
        const body = await response.json();
        deepStrictEqual(body, { message: 'bad request' });
        equal(nockScope.isDone(), true);
    });

    for (const status of retryStatusCodes) {
        test(`should return the response if ok after retrying 3 times ${status} http status code response`, async () => {
            const nockScope = nock('https://test.com')
                .get('/test')
                .times(3)
                .reply(status, { message: 'error' })
                .get('/test')
                .reply(200, { message: 'ok' });
            let retries = 0;
            let attempts = 0;

            const response = await fetchWithRetries('https://test.com/test', {
                method: 'GET',
                retryOptions: {
                    onRetry: params => {
                        attempts = params.attempt;
                        retries++;
                    },
                    initialDelay: 0
                }
            });

            equal(retries, 3, 'retries');
            equal(attempts, 3, 'attempts');
            equal(response.ok, true);
            const body = await response.json();
            deepStrictEqual(body, { message: 'ok' });
            equal(nockScope.isDone(), true);
        });
    }

    for (const status of retryStatusCodes) {
        await test(`should return the response after retrying ${status} http status code response`, async () => {
            const nockScope = nock('https://test.com')
                .get('/test')
                .times(4)
                .reply(status, { message: 'error' });
            let lastRetryIsRateLimitRetry;
            let retries = 0;
            let attempts = 0;

            const response = await fetchWithRetries('https://test.com/test', {
                method: 'GET',
                retryOptions: {
                    onRetry: params => {
                        attempts = params.attempt;
                        lastRetryIsRateLimitRetry = params.rateLimitRetry;
                        retries++;
                    },
                    initialDelay: 0
                }
            });

            equal(retries, 3, 'retries');
            equal(attempts, 3, 'attempts');
            equal(
                lastRetryIsRateLimitRetry,
                false,
                'last retry is rate limit retry'
            );
            equal(response.ok, false);
            equal(response.status, status);
            const body = await response.json();
            deepStrictEqual(body, { message: 'error' });
            equal(nockScope.isDone(), true);
        });
    }

    for (const status of [503, 429]) {
        await test(`should return the response after retrying 10 times ${status} http status code response`, async () => {
            const nockScope = nock('https://test.com')
                .get('/test')
                .times(10)
                .reply(status, { message: 'error' }, { 'Retry-After': '0' })
                .get('/test')
                .reply(200, { message: 'ok' });
            let lastRetryIsRateLimitRetry;
            let retries = 0;
            let attempts = 0;

            const response = await fetchWithRetries('https://test.com/test', {
                method: 'GET',
                retryOptions: {
                    onRetry: params => {
                        attempts = params.attempt;
                        lastRetryIsRateLimitRetry = params.rateLimitRetry;
                        retries++;
                    },
                    initialDelay: 0
                }
            });

            equal(retries, 10, 'retries');
            equal(attempts, 10, 'attempts');
            equal(
                lastRetryIsRateLimitRetry,
                true,
                'last retry is rate limit retry'
            );
            equal(response.ok, true);
            equal(response.status, 200);
            const body = await response.json();
            deepStrictEqual(body, { message: 'ok' });
            equal(nockScope.isDone(), true);
        });
    }

    await test(`should return the response after retrying 10 times 429 http status code response with X-RateLimit-Reset header`, async () => {
        const nockScope = nock('https://test.com')
            .get('/test')
            .times(10)
            .reply(
                429,
                { message: 'error' },
                {
                    'X-RateLimit-Reset': Math.floor(
                        new Date().getTime() / 1000
                    ).toString()
                }
            )
            .get('/test')
            .reply(200, { message: 'ok' });
        let lastRetryIsRateLimitRetry;
        let retries = 0;
        let attempts = 0;

        const response = await fetchWithRetries('https://test.com/test', {
            method: 'GET',
            retryOptions: {
                onRetry: params => {
                    attempts = params.attempt;
                    lastRetryIsRateLimitRetry = params.rateLimitRetry;
                    retries++;
                },
                initialDelay: 0
            }
        });

        equal(retries, 10, 'retries');
        equal(attempts, 10, 'attempts');
        equal(
            lastRetryIsRateLimitRetry,
            true,
            'last retry is rate limit retry'
        );
        equal(response.ok, true);
        equal(response.status, 200);
        const body = await response.json();
        deepStrictEqual(body, { message: 'ok' });
        equal(nockScope.isDone(), true);
    });

    await test('should return the response if ok after retrying 3 times network errors', async () => {
        const nockScope = nock('https://test.com')
            .get('/test')
            .times(3)
            .replyWithError(new FetchError('ENOTFOUND'))
            .get('/test')
            .reply(200, { message: 'ok' });
        let retries = 0;
        let attempts = 0;

        const response = await fetchWithRetries('https://test.com/test', {
            method: 'GET',
            retryOptions: {
                onRetry: params => {
                    attempts = params.attempt;
                    retries++;
                },
                initialDelay: 0
            }
        });

        equal(retries, 3, 'retries');
        equal(attempts, 3, 'attempts');
        equal(response.ok, true);
        const body = await response.json();
        deepStrictEqual(body, { message: 'ok' });
        equal(nockScope.isDone(), true);
    });

    await test('should throw the error without retry if malformed uri', async () => {
        let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
        let retries = 0;

        try {
            await fetchWithRetries('this-is-not-an-uri', {
                method: 'GET',
                retryOptions: {
                    onRetry: () => {
                        retries++;
                    }
                }
            });
        } catch (e) {
            error = e;
        }

        equal(retries, 0, 'retries');
        equal(error instanceof Error, true, 'error instance of error');
        equal(error.message, 'Failed to parse URL from this-is-not-an-uri');
    });

    await test('should throw the error after retrying network errors', async () => {
        const nockScope = nock('https://test.com')
            .get('/test')
            .times(4)
            .replyWithError(new FetchError('ECONNRESET'));
        let retries = 0;
        let attempts = 0;
        let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

        try {
            await fetchWithRetries('https://test.com/test', {
                method: 'GET',
                retryOptions: {
                    onRetry: params => {
                        attempts = params.attempt;
                        retries++;
                    },
                    initialDelay: 0
                }
            });
        } catch (e) {
            error = e;
        }

        equal(retries, 3, 'retries');
        equal(attempts, 3, 'attempts');
        equal(
            error instanceof FetchError,
            true,
            'error instance of fetch error'
        );
        equal(error.cause.code, 'ECONNRESET');
        equal(nockScope.isDone(), true);
    });

    await test('should throw the error after retrying network errors (real one)', async () => {
        nock.enableNetConnect();
        let retries = 0;
        let attempts = 0;
        let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

        try {
            await fetchWithRetries('https://this-url-does-not-exist.com', {
                method: 'GET',
                retryOptions: {
                    onRetry: params => {
                        attempts = params.attempt;
                        retries++;
                    },
                    maxRetries: 1,
                    initialDelay: 0
                }
            });
        } catch (e) {
            error = e;
        }

        equal(retries, 1, 'retries');
        equal(attempts, 1, 'attempts');
        equal(error instanceof Error, true, 'error instance of error');
        equal(error.message, 'fetch failed');
        equal(error.cause.code, 'ENOTFOUND');
    });

    await test('should abort while waiting if signal notify an abort', async () => {
        const nockScope = nock('https://test.com')
            .get('/test')
            .times(4)
            .replyWithError(new FetchError('ECONNREFUSED'));
        let retries = 0;
        let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
        const controller = new AbortController();
        const abortError = new Error('Boom, is aborted');
        try {
            setTimeout(() => controller.abort(abortError), 50);
            await fetchWithRetries('https://test.com/test', {
                method: 'GET',
                signal: controller.signal,
                retryOptions: {
                    onRetry: () => {
                        retries++;
                    },
                    initialDelay: 10_000
                }
            });
        } catch (e) {
            error = e;
        }

        equal(retries, 1, 'retries');
        equal(error instanceof Error, true, 'error instance');
        equal(error.message, 'Boom, is aborted');
        equal(nockScope.isDone(), false);
    });

    await test('should abort while making the request if signal notify an abort', async () => {
        const nockScope = nock('https://test.com')
            .get('/test')
            .delay(200)
            .reply(200, { success: true });
        let retries = 0;
        let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
        const controller = new AbortController();
        const abortError = new Error('Boom, is aborted');

        try {
            setTimeout(() => controller.abort(abortError), 0);
            await fetchWithRetries('https://test.com/test', {
                method: 'GET',
                signal: controller.signal,
                retryOptions: {
                    onRetry: () => {
                        retries++;
                    },
                    initialDelay: 10_000
                }
            });
        } catch (e) {
            error = e;
        }

        equal(retries, 0, 'retries');
        equal(error instanceof Error, true, 'error instance');
        equal(error.message, 'Boom, is aborted');
        equal(nockScope.isDone(), true);
    });
});
