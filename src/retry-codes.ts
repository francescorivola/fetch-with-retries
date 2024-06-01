/**
 * Array of HTTP status codes that should trigger a retry when encountered during a network request.
 * The retry logic can be implemented using these status codes to handle temporary failures.
 *
 * The following status codes are included:
 * - 408: Request Timeout
 * - 425: Too Early
 * - 429: Too Many Requests
 * - 500: Internal Server Error
 * - 502: Bad Gateway
 * - 503: Service Unavailable
 * - 504: Gateway Timeout
 */
export const RETRY_STATUS_CODES = [408, 425, 429, 500, 502, 503, 504];

/**
 * Array of error codes that should trigger a retry when encountered during a network request.
 * The retry logic can be implemented using these error codes to handle temporary failures.
 *
 * The following error codes are included:
 * - ENOTFOUND: No DNS record found
 * - ECONNREFUSED: Connection refused by the server
 * - ECONNRESET: Connection reset by the server
 * - ETIMEDOUT: Connection timed out
 * - EPIPE: Broken pipe
 * - EAI_AGAIN: DNS lookup timed out
 * - EHOSTDOWN: Host is down
 * - EHOSTUNREACH: Host is unreachable
 * - ENETDOWN: Network is down
 * - ENETRESET: Network connection reset
 * - ENETUNREACH: Network is unreachable
 * - ECONNABORTED: Connection aborted
 */
export const RETRY_ERROR_CODES = [
    'ENOTFOUND',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'EAI_AGAIN',
    'EHOSTDOWN',
    'EHOSTUNREACH',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'ECONNABORTED'
];
