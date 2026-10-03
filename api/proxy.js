// api/proxy.js - Vercel Serverless Function
export default async function handler(req, res) {
  // CORS başlıkları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  res.setHeader('Vary', 'Origin, Range');

  // Preflight (OPTIONS) isteği
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const target = req.query.url;
  if (!target) {
    return res.status(400).json({ error: 'Missing ?url= parameter' });
  }

  // URL doğrulama
  let targetUrl;
  try {
    targetUrl = new URL(target);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      throw new Error('Invalid protocol');
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    // Hedef sunucuya istek at
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/151.0 Mobile Safari/537.36',
      'Referer': 'https://www.evoolipxnyxzq.shop/', // İPTV sağlayıcınızın sitesi
      'Accept-Encoding': 'identity',
    };

    // Range ve diğer başlıkları aktar
    for (const name of ['range', 'accept', 'if-range', 'if-none-match', 'if-modified-since']) {
      if (req.headers[name]) upstreamHeaders[name] = req.headers[name];
    }

    const upstream = await fetch(targetUrl.href, {
      method: req.method,
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    // İçerik tipini belirle
    let contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const pathname = targetUrl.pathname.toLowerCase();
    if (pathname.endsWith('.m3u8') || pathname.endsWith('.m3u')) {
      contentType = 'application/vnd.apple.mpegurl';
    } else if (pathname.endsWith('.mp4')) {
      contentType = 'video/mp4';
    }

    // Önemli başlıkları geri gönder
    const headersToForward = ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control'];
    for (const name of headersToForward) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    // M3U8 playlist ise URL'leri yeniden yaz
    if (contentType.includes('mpegurl') || pathname.endsWith('.m3u8')) {
      const playlist = await upstream.text();
      const workerBase = `https://${req.headers.host}/api/proxy?url=`;
      
      const rewritten = playlist.split(/\r?\n/).map(line => {
        if (!line || line.startsWith('#')) {
          // URI="" içindeki adresleri de değiştir
          return line.replace(/URI="([^"]+)"/g, (match, uri) => {
            try {
              const abs = new URL(uri, targetUrl.href).href;
              return `URI="${workerBase}${encodeURIComponent(abs)}"`;
            } catch {
              return match;
            }
          });
        }
        // Normal satırları yeniden yaz
        try {
          const abs = new URL(line, targetUrl.href).href;
          return `${workerBase}${encodeURIComponent(abs)}`;
        } catch {
          return line;
        }
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      return res.status(upstream.status).send(rewritten);
    }

    // Normal yanıt (JSON, video segment, vs.)
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.status(upstream.status).send(buffer);

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(502).json({ 
      error: 'Proxy error', 
      message: error instanceof Error ? error.message : String(error) 
    });
  }
}
