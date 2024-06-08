import * as http from 'http';

/**
 * Creates a local server. By default it will return a 200 status code with the message 'My first server!'.
 * @param port The port where the server will listen to. Default is 30000
 * @returns
 */
export function createTestServer(port: number = 30000) {
    let requestListener: http.RequestListener = (req, res) => {
        res.writeHead(200);
        res.end('My first server!');
    };
    const server = http.createServer((req, res) => requestListener(req, res));

    server.listen(port, '127.0.0.1');

    return {
        close: () => server.close(),
        setRequestListener: (newRequestListener: http.RequestListener) => {
            requestListener = newRequestListener;
        }
    };
}
