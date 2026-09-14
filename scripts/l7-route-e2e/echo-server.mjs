import http from 'node:http';
import crypto from 'node:crypto';

const serviceName = process.argv[2] || 'origin-generic';
const port = parseInt(process.argv[3] || '8080', 10);

function encodeFrame(opcode, payload) {
  let header;
  const len = payload.length;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

const server = http.createServer((req, res) => {
  // Server-Sent Events endpoint
  if (req.url === '/sse' || req.url?.startsWith('/sse')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'close',
      'X-Echo-Service': serviceName,
    });
    for (let i = 1; i <= 3; i++) {
      res.write(`data: ${JSON.stringify({ seq: i, message: `event_${i}` })}\n\n`);
    }
    res.end();
    return;
  }

  // Generic HTTP echo (handles GET, POST, PUT, DELETE, PATCH, Chunked Encoding)
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const responseData = JSON.stringify({
      service: serviceName,
      method: req.method,
      path: req.url,
      headers: req.headers,
      body,
    }, null, 2);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(responseData),
      'X-Echo-Service': serviceName,
    });
    res.end(responseData);
  });
});

// RFC 6455 WebSocket Echo Server
server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const b1 = buffer[0];
      const b2 = buffer[1];
      const opcode = b1 & 0x0f;
      if (opcode === 0x8) { // close frame
        socket.end();
        return;
      }
      const masked = (b2 & 0x80) !== 0;
      let payloadLen = b2 & 0x7f;
      let offset = 2;
      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (buffer.length < offset + payloadLen) return;

      let payload = buffer.subarray(offset, offset + payloadLen);
      if (masked) {
        const mask = buffer.subarray(maskOffset, maskOffset + 4);
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      buffer = buffer.subarray(offset + payloadLen);

      if (opcode === 0x9) { // Ping -> Pong
        socket.write(encodeFrame(0x0A, payload));
      } else if (opcode === 0x2) { // Binary -> Binary echo
        const echoPayload = Buffer.concat([Buffer.from('BIN_ECHO:'), payload]);
        socket.write(encodeFrame(0x02, echoPayload));
      } else if (opcode === 0x1) { // Text -> Text echo
        const echoPayload = Buffer.concat([Buffer.from('ECHO:'), payload]);
        socket.write(encodeFrame(0x01, echoPayload));
      }
    }
  });

  socket.on('error', () => {});
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[EchoService] ${serviceName} listening on 0.0.0.0:${port}`);
});
