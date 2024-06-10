import { describe, after, test } from 'node:test';
import { equal, deepStrictEqual } from 'node:assert';
import { fetchWithRetries } from '../src/index';
import { createTestServer } from './util/test-server';

describe('fetch-with-retries-real-network', async () => {
    const server = await createTestServer();

    await after(async () => {
        await server.close();
    });

    await test('should return the response if ok', async () => {
        server.setRequestListener((req, res) => {
            res.writeHead(200);
            res.end(JSON.stringify({ message: 'ok' }));
        });

        let retries = 0;

        const response = await fetchWithRetries('http://localhost:30000', {
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
    });

    await test('should throw the error after retrying network errors', async () => {
        let retries = 0;
        let attempts = 0;
        let error: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

        server.setRequestListener((req, res) => {
            setTimeout(() => {
                res.writeHead(200);
                res.end(JSON.stringify({ message: 'ok' }));
            }, 1000);
        });

        try {
            await fetchWithRetries('http://localhost:30000', {
                method: 'GET',
                retryOptions: {
                    onRetry: params => {
                        attempts = params.attempt;
                        retries++;
                    },
                    maxRetries: 1,
                    initialDelay: 0
                },
                signal: AbortSignal.timeout(50)
            });
        } catch (e) {
            error = e;
        }

        equal(retries, 1, 'retries');
        equal(attempts, 1, 'attempts');
        equal(error instanceof Error, true, 'error instance of error');
        equal(error.name, 'TimeoutError');
    });
});
