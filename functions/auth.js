// Cloudflare Pages Function - GitHub OAuth for Decap CMS
// 设置方法见下方注释

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { searchParams, pathname } = url;

  // 获取环境变量（在 Cloudflare Dashboard 中设置）
  const CLIENT_ID = env.GITHUB_CLIENT_ID;
  const CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;
  const SITE_URL = env.SITE_URL || url.origin;

  // ── 第一步：跳转到 GitHub 授权 ──
  if (pathname.endsWith('/auth')) {
    const redirectUri = `${SITE_URL}/auth/callback`;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?` +
      `client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&` +
      `scope=repo,user&response_type=code`;
    return Response.redirect(githubAuthUrl, 302);
  }

  // ── 第二步：GitHub 回调，换取 Token ──
  if (pathname.endsWith('/auth/callback')) {
    const code = searchParams.get('code');
    if (!code) {
      return new Response('Missing code', { status: 400 });
    }

    // 用 code 换取 access_token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code
      })
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return new Response('Failed to get token: ' + JSON.stringify(tokenData), { status: 400 });
    }

    // 重定向回 CMS 管理页面，带上 token
    // Decap CMS 会从 URL 参数中读取 token
    return Response.redirect(`${SITE_URL}/admin/#access_token=${accessToken}`, 302);
  }

  return new Response('Not found', { status: 404 });
}
