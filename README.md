# Fetch With Retries

Fetch With Retries is a TypeScript library that provides a robust way to make requests to an API with automatic retry logic.
It's designed to handle both network errors and service issues, such as rate limiting.

[ ![Npm Version](https://badge.fury.io/js/fetch-with-retries.svg)](https://www.npmjs.com/package/fetch-with-retries)
[![Actions Status](https://github.com/francescorivola/fetch-with-retries/workflows/Node%20CI/badge.svg)](https://github.com/francescorivola/fetch-with-retries/actions)
[![CodeFactor](https://www.codefactor.io/repository/github/francescorivola/fetch-with-retries/badge)](https://www.codefactor.io/repository/github/francescorivola/fetch-with-retries)
[![codecov](https://codecov.io/gh/francescorivola/fetch-with-retries/branch/master/graph/badge.svg)](https://codecov.io/gh/francescorivola/fetch-with-retries)
[![Dependabot](https://badgen.net/badge/Dependabot/enabled/green?icon=dependabot)](https://dependabot.com/)

## Features

-   Automatic retries for network errors and certain HTTP status codes.
-   Exponential backoff for retry delays.
-   Support for `Retry-After` and `X-RateLimit-Reset` headers.
-   Customizable retry conditions.
-   Allow to abort wait between retries with fetch signal and AbortController

## Installation

```bash
npm install fetch-with-retries
```

## License

Fetch With Retries is MIT licensed.
