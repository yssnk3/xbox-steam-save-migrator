import https from 'https';
// 直接验证 2149010 的 header.jpg 是否存在（走 DoH 拿 IP 再 SNI 直连）
const t0 = Date.now();
const doh = await fetch('https://223.5.5.5/resolve?name=cdn.cloudflare.steamstatic.com&type=A', { headers: { Host: 'dns.alidns.com' } });
