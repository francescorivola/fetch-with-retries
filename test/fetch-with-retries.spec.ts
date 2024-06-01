import * as nock from 'nock';
import { describe, beforeEach, afterEach, test } from 'node:test';
import { equal, deepStrictEqual } from 'node:assert';
import { buildFetchWithRetries } from '../src/index';

const retryStatusCodes = [408, 425, 429, 500, 502, 503, 504];

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
        const fetchWithRetries = buildFetchWithRetries();
        let retries = 0;

        const response = await fetchWithRetries(
            'https://test.com/test',
            {
                method: 'GET'
            },
            {
                onRetry: () => {
                    retries++;
                }
            }
        );

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
        const fetchWithRetries = buildFetchWithRetries({
            maxRetries: 1,
            initialDelay: 1000,
            factor: 2,
            rateLimit: {
                maxRetries: 10,
                maxDelay: 60_000
            }
        });
        let retries = 0;

        const response = await fetchWithRetries(
            'https://test.com/test',
            {
                method: 'GET'
            },
            {
                onRetry: () => {
                    retries++;
                }
            }
        );

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
            const fetchWithRetries = buildFetchWithRetries({
                maxRetries: 3,
                initialDelay: 0,
                factor: 2,
                rateLimit: {
                    maxRetries: 10,
                    maxDelay: 60_000
                }
            });
            let retries = 0;
            let attempts = 0;

            const response = await fetchWithRetries(
                'https://test.com/test',
                {
                    method: 'GET'
                },
                {
                    onRetry: params => {
                        attempts = params.attempt;
                        retries++;
                    }
                }
            );

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
            const fetchWithRetries = buildFetchWithRetries({
                maxRetries: 3,
                initialDelay: 0,
                factor: 2,
                rateLimit: {
                    maxRetries: 10,
                    maxDelay: 60_000
                }
            });
            let lastRetryIsRateLimitRetry;
            let retries = 0;
            let attempts = 0;

            const response = await fetchWithRetries(
                'https://test.com/test',
                {
                    method: 'GET'
                },
                {
                    onRetry: params => {
                        attempts = params.attempt;
                        lastRetryIsRateLimitRetry = params.rateLimitRetry;
                        retries++;
                    }
                }
            );

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
            const fetchWithRetries = buildFetchWithRetries({
                maxRetries: 3,
                initialDelay: 0,
                factor: 2,
                rateLimit: {
                    maxRetries: 10,
                    maxDelay: 60_000
                }
            });
            let lastRetryIsRateLimitRetry;
            let retries = 0;
            let attempts = 0;

            const response = await fetchWithRetries(
                'https://test.com/test',
                {
                    method: 'GET'
                },
                {
                    onRetry: params => {
                        attempts = params.attempt;
                        lastRetryIsRateLimitRetry = params.rateLimitRetry;
                        retries++;
                    }
                }
            );

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
        const fetchWithRetries = buildFetchWithRetries({
            maxRetries: 3,
            initialDelay: 0,
            factor: 2,
            rateLimit: {
                maxRetries: 10,
                maxDelay: 60_000
            }
        });
        let lastRetryIsRateLimitRetry;
        let retries = 0;
        let attempts = 0;

        const response = await fetchWithRetries(
            'https://test.com/test',
            {
                method: 'GET'
            },
            {
                onRetry: params => {
                    attempts = params.attempt;
                    lastRetryIsRateLimitRetry = params.rateLimitRetry;
                    retries++;
                }
            }
        );

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
            .replyWithError(new Error('Network error'))
            .get('/test')
            .reply(200, { message: 'ok' });
        const fetchWithRetries = buildFetchWithRetries({
            maxRetries: 3,
            initialDelay: 0,
            factor: 2,
            rateLimit: {
                maxRetries: 10,
                maxDelay: 60_000
            }
        });
        let retries = 0;
        let attempts = 0;

        const response = await fetchWithRetries(
            'https://test.com/test',
            {
                method: 'GET'
            },
            {
                onRetry: params => {
                    attempts = params.attempt;
                    retries++;
                }
            }
        );

        equal(retries, 3, 'retries');
        equal(attempts, 3, 'attempts');
        equal(response.ok, true);
        const body = await response.json();
        deepStrictEqual(body, { message: 'ok' });
        equal(nockScope.isDone(), true);
    });

    await test('should throw the error after retrying network errors', async () => {
        const nockScope = nock('https://test.com')
            .get('/test')
            .times(4)
            .replyWithError(new Error('Network error'));
        const fetchWithRetries = buildFetchWithRetries({
            maxRetries: 3,
            initialDelay: 0,
            factor: 2,
            rateLimit: {
                maxRetries: 10,
                maxDelay: 60_000
            }
        });
        let retries = 0;
        let attempts = 0;
        let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

        try {
            await fetchWithRetries(
                'https://test.com/test',
                {
                    method: 'GET'
                },
                {
                    onRetry: params => {
                        attempts = params.attempt;
                        retries++;
                    }
                }
            );
        } catch (e) {
            error = e;
        }

        equal(retries, 3, 'retries');
        equal(attempts, 3, 'attempts');
        equal(error instanceof Error, true, 'error instance of error');
        equal(error.message, 'Network error');
        equal(nockScope.isDone(), true);
    });

    await test('should abort while waiting if signal notify an abort', async () => {
        const nockScope = nock('https://test.com')
            .get('/test')
            .times(4)
            .replyWithError(new Error('Network error'));
        const fetchWithRetries = buildFetchWithRetries({
            maxRetries: 1,
            initialDelay: 10000,
            factor: 2,
            rateLimit: {
                maxRetries: 10,
                maxDelay: 60_000
            }
        });
        let retries = 0;
        let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
        const controller = new AbortController();
        const abortError = new Error('Boom, is aborted');
        try {
            setTimeout(() => controller.abort(abortError), 50);
            await fetchWithRetries(
                'https://test.com/test',
                {
                    method: 'GET',
                    signal: controller.signal
                },
                {
                    onRetry: () => {
                        retries++;
                    }
                }
            );
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
        const fetchWithRetries = buildFetchWithRetries({
            maxRetries: 1,
            initialDelay: 10000,
            factor: 2,
            rateLimit: {
                maxRetries: 10,
                maxDelay: 60_000
            }
        });
        let retries = 0;
        let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
        const controller = new AbortController();
        const abortError = new Error('Boom, is aborted');

        try {
            setTimeout(() => controller.abort(abortError), 0);
            await fetchWithRetries(
                'https://test.com/test',
                {
                    method: 'GET',
                    signal: controller.signal
                },
                {
                    onRetry: () => {
                        retries++;
                    }
                }
            );
        } catch (e) {
            error = e;
        }

        equal(retries, 0, 'retries');
        equal(error instanceof Error, true, 'error instance');
        equal(error.message, 'Boom, is aborted');
        equal(nockScope.isDone(), true);
    });
});
