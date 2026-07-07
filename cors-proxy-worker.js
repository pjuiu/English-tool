/**
 * 极简 CORS 代理 —— 部署到 Cloudflare Workers（免费额度：每天 10 万次请求，个人用绰绰有余）
 *
 * 用途：手机端打开"影子跟读实验室.html"时，部分播客/音频托管方不允许网页直接读取音频字节
 * （没有 CORS 头），导致本地转写/API 转写都拿不到音频数据。这个 Worker 跑在 Cloudflare 的服务器上，
 * 由服务器去请求原始地址（服务器对服务器没有 CORS 限制），再把结果转发给浏览器时加上允许跨域的头。
 *
 * 部署步骤（网页操作，不需要装任何软件）：
 * 1. 打开 https://dash.cloudflare.com 注册/登录（免费，只需邮箱）
 * 2. 左侧菜单找「Workers 和 Pages」→ 点「创建」→ 选「创建 Worker」
 * 3. 起个名字（比如 my-audio-proxy），点「部署」
 * 4. 部署完成后点「编辑代码」，把这个文件的全部内容粘贴进去，覆盖默认内容，点右上角「部署」
 * 5. 部署完成后会得到一个地址，形如 https://my-audio-proxy.你的用户名.workers.dev
 * 6. 把这个地址填进"影子跟读实验室.html"右上角「⚙ API 设置」里的"CORS 代理 Worker URL"，保存
 *
 * 之后手机/电脑上遇到"该托管方不允许网页读取音频字节"的提示时，工具会自动通过这个代理重试。
 */

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);

    // CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return new Response('缺少 url 参数，用法：?url=https://example.com/audio.mp3', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('url 参数不是合法链接', { status: 400 });
    }
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return new Response('只允许代理 http/https 链接', { status: 400 });
    }

    // 原样转发 Range 头，支持音频拖动进度条（分段请求）
    const fwdHeaders = new Headers();
    const range = request.headers.get('Range');
    if (range) fwdHeaders.set('Range', range);
    fwdHeaders.set('User-Agent', 'Mozilla/5.0');

    let originRes;
    try {
      originRes = await fetch(targetUrl.toString(), { headers: fwdHeaders });
    } catch (e) {
      return new Response('代理请求失败：' + e.message, { status: 502 });
    }

    // 流式转发响应体，不在 Worker 里整个缓冲，大文件也不会超内存/超时限制
    const headers = new Headers(originRes.headers);
    Object.entries(corsHeaders(request)).forEach(([k, v]) => headers.set(k, v));
    headers.set('Accept-Ranges', 'bytes');

    return new Response(originRes.body, {
      status: originRes.status,
      statusText: originRes.statusText,
      headers,
    });
  },
};

function corsHeaders(request) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  };
}
