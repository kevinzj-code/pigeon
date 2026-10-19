/* http-status.js — the HTTP status codes worth naming, and what they mean.
 *
 * A bundled table, so it carries a date: the registry is not frozen (451 and
 * 425 are recent additions) and a lookup table that cannot go stale is a table
 * that is lying about itself.
 *
 * `retryable` is the field people actually want and no spec states directly:
 * whether repeating the identical request could plausibly succeed. 503 and 429
 * yes; 404 and 403 no. It is a judgement, which is why it is here in a dated
 * table rather than derived from the number.
 */

export const STATUS_AS_OF = '2026-08-29';

export const HTTP_STATUS = {
  100: { name: 'Continue', meaning: 'the client should carry on with the request', category: 'informational', retryable: false },
  101: { name: 'Switching Protocols', meaning: 'the server is changing protocol as asked', category: 'informational', retryable: false },
  200: { name: 'OK', meaning: 'the request succeeded', category: 'success', retryable: false },
  201: { name: 'Created', meaning: 'the request succeeded and made a new resource', category: 'success', retryable: false },
  202: { name: 'Accepted', meaning: 'the request was accepted but is not finished', category: 'success', retryable: false },
  204: { name: 'No Content', meaning: 'the request succeeded and there is nothing to return', category: 'success', retryable: false },
  206: { name: 'Partial Content', meaning: 'the server is returning part of the resource', category: 'success', retryable: false },
  301: { name: 'Moved Permanently', meaning: 'the resource has a new permanent address', category: 'redirection', retryable: false },
  302: { name: 'Found', meaning: 'the resource is temporarily somewhere else', category: 'redirection', retryable: false },
  303: { name: 'See Other', meaning: 'fetch the result from another address with GET', category: 'redirection', retryable: false },
  304: { name: 'Not Modified', meaning: 'the cached copy is still current', category: 'redirection', retryable: false },
  307: { name: 'Temporary Redirect', meaning: 'same request, temporarily at another address', category: 'redirection', retryable: false },
  308: { name: 'Permanent Redirect', meaning: 'same request, permanently at another address', category: 'redirection', retryable: false },
  400: { name: 'Bad Request', meaning: 'the server could not understand the request', category: 'client error', retryable: false },
  401: { name: 'Unauthorized', meaning: 'the request needs authentication', category: 'client error', retryable: false },
  402: { name: 'Payment Required', meaning: 'payment is needed to proceed', category: 'client error', retryable: false },
  403: { name: 'Forbidden', meaning: 'the server understood but refuses to authorise it', category: 'client error', retryable: false },
  404: { name: 'Not Found', meaning: 'the server has no resource at that address', category: 'client error', retryable: false },
  405: { name: 'Method Not Allowed', meaning: 'that method is not supported for this resource', category: 'client error', retryable: false },
  406: { name: 'Not Acceptable', meaning: 'nothing available matches what the client will accept', category: 'client error', retryable: false },
  408: { name: 'Request Timeout', meaning: 'the client took too long to send the request', category: 'client error', retryable: true },
  409: { name: 'Conflict', meaning: 'the request clashes with the current state', category: 'client error', retryable: false },
  410: { name: 'Gone', meaning: 'the resource was deliberately removed', category: 'client error', retryable: false },
  413: { name: 'Payload Too Large', meaning: 'the request body is bigger than the server accepts', category: 'client error', retryable: false },
  414: { name: 'URI Too Long', meaning: 'the address is longer than the server accepts', category: 'client error', retryable: false },
  415: { name: 'Unsupported Media Type', meaning: 'the body format is not one the server handles', category: 'client error', retryable: false },
  418: { name: 'I\'m a teapot', meaning: 'an April Fools joke from 1998 that never went away', category: 'client error', retryable: false },
  422: { name: 'Unprocessable Content', meaning: 'the request was understood but is semantically wrong', category: 'client error', retryable: false },
  425: { name: 'Too Early', meaning: 'the server will not risk replaying this request', category: 'client error', retryable: true },
  428: { name: 'Precondition Required', meaning: 'the request must be conditional', category: 'client error', retryable: false },
  429: { name: 'Too Many Requests', meaning: 'the client has sent too many requests in a given time', category: 'client error', retryable: true },
  431: { name: 'Request Header Fields Too Large', meaning: 'the headers are bigger than the server accepts', category: 'client error', retryable: false },
  451: { name: 'Unavailable For Legal Reasons', meaning: 'the resource is blocked for legal reasons', category: 'client error', retryable: false },
  500: { name: 'Internal Server Error', meaning: 'something went wrong on the server', category: 'server error', retryable: true },
  501: { name: 'Not Implemented', meaning: 'the server does not support what was asked', category: 'server error', retryable: false },
  502: { name: 'Bad Gateway', meaning: 'an upstream server returned something invalid', category: 'server error', retryable: true },
  503: { name: 'Service Unavailable', meaning: 'the server is temporarily unable to handle the request', category: 'server error', retryable: true },
  504: { name: 'Gateway Timeout', meaning: 'an upstream server did not respond in time', category: 'server error', retryable: true },
  507: { name: 'Insufficient Storage', meaning: 'the server is out of room to complete the request', category: 'server error', retryable: false },
  511: { name: 'Network Authentication Required', meaning: 'the network needs you to authenticate first', category: 'server error', retryable: false }
};
