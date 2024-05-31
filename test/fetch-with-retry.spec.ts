import nock from "nock";
import { describe, beforeEach, afterEach, test } from "node:test";
import { toEqual } from "node:assert";
import { buildFetchWithRetries } from "../src/fetch-with-retry";

const retryStatusCodes = [408, 425, 429, 500, 502, 503, 504];

describe("fetch-with-retry", async () => {
  await beforeEach(() => {
    nock.disableNetConnect();
  });

  await afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  await test("should return the response if ok", async () => {
    const nockScope = nock("https://test.com")
      .get("/test")
      .reply(200, { message: "ok" });
    const fetchWithRetries = buildFetchWithRetries({
      maxRetries: 1,
      initialDelay: 1000,
      factor: 2,
      rateLimit: {
        maxRetries: 10,
        maxDelay: 60_000,
      },
    });
    let retries = 0;

    const response = await fetchWithRetries(
      "https://test.com/test",
      {
        method: "GET",
      },
      {
        onRetry: () => {
          retries++;
        },
      },
    );

    toEqual(retries, 0, "retries");
    expect(response.ok).to.equal(true);
    const body = await response.json();
    expect(body).to.be.deep.equal({ message: "ok" });
    expect(nockScope.isDone()).to.equal(true);
  });

  await test("should return the response if not ok and cannot be retried", async () => {
    const nockScope = nock("https://test.com")
      .get("/test")
      .reply(400, { message: "bad request" });
    const fetchWithRetries = buildFetchWithRetries({
      maxRetries: 1,
      initialDelay: 1000,
      factor: 2,
      rateLimit: {
        maxRetries: 10,
        maxDelay: 60_000,
      },
    });
    let retries = 0;

    const response = await fetchWithRetries(
      "https://test.com/test",
      {
        method: "GET",
      },
      {
        onRetry: () => {
          retries++;
        },
      },
    );

    expect(retries).to.equal(0, "retries");
    expect(response.ok).to.equal(false);
    const body = await response.json();
    expect(body).to.be.deep.equal({ message: "bad request" });
    expect(nockScope.isDone()).to.equal(true);
  });

  for (const status of retryStatusCodes) {
    test(`should return the response if ok after retrying 3 times ${status} http status code response`, async () => {
      const nockScope = nock("https://test.com")
        .get("/test")
        .times(3)
        .reply(status, { message: "error" })
        .get("/test")
        .reply(200, { message: "ok" });
      const fetchWithRetries = buildFetchWithRetries({
        maxRetries: 3,
        initialDelay: 0,
        factor: 2,
        rateLimit: {
          maxRetries: 10,
          maxDelay: 60_000,
        },
      });
      let retries = 0;
      let attempts = 0;

      const response = await fetchWithRetries(
        "https://test.com/test",
        {
          method: "GET",
        },
        {
          onRetry: (params) => {
            attempts = params.attempt;
            retries++;
          },
        },
      );

      expect(retries).to.equal(3, "retries");
      expect(attempts).to.equal(3, "attempts");
      expect(response.ok).to.equal(true);
      const body = await response.json();
      expect(body).to.be.deep.equal({ message: "ok" });
      expect(nockScope.isDone()).to.equal(true);
    });
  }

  for (const status of retryStatusCodes) {
    await test(`should return the response after retrying ${status} http status code response`, async () => {
      const nockScope = nock("https://test.com")
        .get("/test")
        .times(4)
        .reply(status, { message: "error" });
      const fetchWithRetries = buildFetchWithRetries({
        maxRetries: 3,
        initialDelay: 0,
        factor: 2,
        rateLimit: {
          maxRetries: 10,
          maxDelay: 60_000,
        },
      });
      let lastRetryIsRateLimitRetry;
      let retries = 0;
      let attempts = 0;

      const response = await fetchWithRetries(
        "https://test.com/test",
        {
          method: "GET",
        },
        {
          onRetry: (params) => {
            attempts = params.attempt;
            lastRetryIsRateLimitRetry = params.rateLimitRetry;
            retries++;
          },
        },
      );

      expect(retries).to.equal(3, "retries");
      expect(attempts).to.equal(3, "attempts");
      expect(lastRetryIsRateLimitRetry).to.equal(
        false,
        "last retry is rate limit retry",
      );
      expect(response.ok).to.equal(false);
      expect(response.status).to.equal(status);
      const body = await response.json();
      expect(body).to.be.deep.equal({ message: "error" });
      expect(nockScope.isDone()).to.equal(true);
    });
  }

  for (const status of [503, 429]) {
    await test(`should return the response after retrying 10 times ${status} http status code response`, async () => {
      const nockScope = nock("https://test.com")
        .get("/test")
        .times(10)
        .reply(status, { message: "error" }, { "Retry-After": "0" })
        .get("/test")
        .reply(200, { message: "ok" });
      const fetchWithRetries = buildFetchWithRetries({
        maxRetries: 3,
        initialDelay: 0,
        factor: 2,
        rateLimit: {
          maxRetries: 10,
          maxDelay: 60_000,
        },
      });
      let lastRetryIsRateLimitRetry;
      let retries = 0;
      let attempts = 0;

      const response = await fetchWithRetries(
        "https://test.com/test",
        {
          method: "GET",
        },
        {
          onRetry: (params) => {
            attempts = params.attempt;
            lastRetryIsRateLimitRetry = params.rateLimitRetry;
            retries++;
          },
        },
      );

      expect(retries).to.equal(10, "retries");
      expect(attempts).to.equal(10, "attempts");
      expect(lastRetryIsRateLimitRetry).to.equal(
        true,
        "last retry is rate limit retry",
      );
      expect(response.ok).to.equal(true);
      expect(response.status).to.equal(200);
      const body = await response.json();
      expect(body).to.be.deep.equal({ message: "ok" });
      expect(nockScope.isDone()).to.equal(true);
    });
  }

  await test("should return the response if ok after retrying 3 times network errors", async () => {
    const nockScope = nock("https://test.com")
      .get("/test")
      .times(3)
      .replyWithError(new Error("Network error"))
      .get("/test")
      .reply(200, { message: "ok" });
    const fetchWithRetries = buildFetchWithRetries({
      maxRetries: 3,
      initialDelay: 0,
      factor: 2,
      rateLimit: {
        maxRetries: 10,
        maxDelay: 60_000,
      },
    });
    let retries = 0;
    let attempts = 0;

    const response = await fetchWithRetries(
      "https://test.com/test",
      {
        method: "GET",
      },
      {
        onRetry: (params) => {
          attempts = params.attempt;
          retries++;
        },
      },
    );

    expect(retries).to.equal(3, "retries");
    expect(attempts).to.equal(3, "attempts");
    expect(response.ok).to.equal(true);
    const body = await response.json();
    expect(body).to.be.deep.equal({ message: "ok" });
    expect(nockScope.isDone()).to.equal(true);
  });

  await test("should throw the error after retrying network errors", async () => {
    const nockScope = nock("https://test.com")
      .get("/test")
      .times(4)
      .replyWithError(new Error("Network error"));
    const fetchWithRetries = buildFetchWithRetries({
      maxRetries: 3,
      initialDelay: 0,
      factor: 2,
      rateLimit: {
        maxRetries: 10,
        maxDelay: 60_000,
      },
    });
    let retries = 0;
    let attempts = 0;
    let error = null;

    try {
      await fetchWithRetries(
        "https://test.com/test",
        {
          method: "GET",
        },
        {
          onRetry: (params) => {
            attempts = params.attempt;
            retries++;
          },
        },
      );
    } catch (e) {
      error = e;
    }

    expect(retries).to.equal(3, "retries");
    expect(attempts).to.equal(3, "attempts");
    expect(error instanceof Error).to.equal(true, "error instance of error");
    expect(error.message).to.equal(
      "request to https://test.com/test failed, reason: Network error",
    );
    expect(nockScope.isDone()).to.equal(true);
  });

  await test("should abort while waiting if signal notify an abort", async () => {
    const nockScope = nock("https://test.com")
      .get("/test")
      .times(4)
      .replyWithError(new Error("Network error"));
    const fetchWithRetries = buildFetchWithRetries({
      maxRetries: 1,
      initialDelay: 10000,
      factor: 2,
      rateLimit: {
        maxRetries: 10,
        maxDelay: 60_000,
      },
    });
    let retries = 0;
    let error = null;
    const controller = new AbortController();
    const abortError = new Error("Boom, is aborted");
    try {
      setTimeout(() => controller.abort(abortError), 50);
      await fetchWithRetries(
        "https://test.com/test",
        {
          method: "GET",
          signal: controller.signal,
        },
        {
          onRetry: () => {
            retries++;
          },
        },
      );
    } catch (e) {
      error = e;
    }

    expect(retries).to.equal(1, "retries");
    expect(error instanceof Error).to.equal(true, "error instance");
    expect(error.message).to.equal("Boom, is aborted");
    expect(nockScope.isDone()).to.equal(false);
  });

  await test("should abort while making the request if signal notify an abort", async () => {
    const nockScope = nock("https://test.com")
      .get("/test")
      .delay(200)
      .reply(200, { success: true });
    const fetchWithRetries = buildFetchWithRetries({
      maxRetries: 1,
      initialDelay: 10000,
      factor: 2,
      rateLimit: {
        maxRetries: 10,
        maxDelay: 60_000,
      },
    });
    let retries = 0;
    let error = null;
    const controller = new AbortController();
    const abortError = new Error("Boom, is aborted");

    try {
      setTimeout(() => controller.abort(abortError), 0);
      await fetchWithRetries(
        "https://test.com/test",
        {
          method: "GET",
          signal: controller.signal,
        },
        {
          onRetry: () => {
            retries++;
          },
        },
      );
    } catch (e) {
      error = e;
    }

    expect(retries).to.equal(0, "retries");
    expect(error instanceof Error).to.equal(true, "error instance");
    expect(error.message).to.equal("Boom, is aborted");
    expect(nockScope.isDone()).to.equal(true);
  });
});
