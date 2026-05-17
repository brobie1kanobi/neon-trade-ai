import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CONNECTOR_ID = '6a09f1308b3ef44f133e022c';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'listRepos';

    const { accessToken } = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);

    if (action === 'listRepos') {
      const resp = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (!resp.ok) {
        const err = await resp.text();
        return Response.json({ error: `GitHub API error: ${resp.status} ${err}` }, { status: resp.status });
      }
      const repos = await resp.json();
      return Response.json({
        success: true,
        repos: repos.map(r => ({
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          html_url: r.html_url,
          description: r.description,
          private: r.private,
          language: r.language,
          updated_at: r.updated_at
        }))
      });
    }

    if (action === 'createRepo') {
      const { name, description, isPrivate } = body;
      if (!name) {
        return Response.json({ error: 'Repository name is required' }, { status: 400 });
      }

      const resp = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          description: description || '',
          private: isPrivate !== false,
          auto_init: true
        })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return Response.json({ error: err.message || `GitHub error: ${resp.status}` }, { status: resp.status });
      }

      const repo = await resp.json();
      return Response.json({
        success: true,
        repo: {
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          html_url: repo.html_url,
          clone_url: repo.clone_url,
          private: repo.private
        }
      });
    }

    if (action === 'getUser') {
      const resp = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (!resp.ok) {
        return Response.json({ error: 'Failed to get GitHub user' }, { status: resp.status });
      }
      const ghUser = await resp.json();
      return Response.json({
        success: true,
        user: {
          login: ghUser.login,
          name: ghUser.name,
          avatar_url: ghUser.avatar_url,
          html_url: ghUser.html_url,
          public_repos: ghUser.public_repos
        }
      });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});