# Fetch With Retries

Fetch With Retries is a TypeScript library that provides a robust way to make requests to an API with automatic retry logic.
It's designed to handle both network errors and service issues, such as rate limiting.

## Features

-   Automatic retries for network errors and certain HTTP status codes.
-   Exponential backoff for retry delays.
-   Support for `Retry-After` and `X-RateLimit-Reset` headers.
-   Customizable retry conditions.
-   Allow to abort wait before retry with fetch signal and AbortController

## Installation

```bash
npm install fetch-with-retries
```

## License

Fetch With Retries is MIT licensed.
