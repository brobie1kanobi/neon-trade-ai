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

    // Quick connection check that doesn't hit GitHub API
    if (action === 'checkConnection') {
      try {
        const { accessToken } = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
        return Response.json({ success: true, is_connected: !!accessToken });
      } catch {
        return Response.json({ success: true, is_connected: false });
      }
    }

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

    if (action === 'getRepoContents') {
      const { owner, repo, path } = body;
      if (!owner || !repo) {
        return Response.json({ error: 'owner and repo are required' }, { status: 400 });
      }
      const apiPath = path ? `/${path}` : '';
      const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents${apiPath}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (!resp.ok) {
        if (resp.status === 404) {
          return Response.json({ success: true, contents: [] });
        }
        const err = await resp.text();
        return Response.json({ error: `GitHub API error: ${resp.status} ${err}` }, { status: resp.status });
      }
      const contents = await resp.json();
      return Response.json({ success: true, contents: Array.isArray(contents) ? contents : [contents] });
    }

    if (action === 'pushFiles') {
      const { owner, repo, files, commitMessage, branch } = body;
      if (!owner || !repo || !files || !Array.isArray(files) || files.length === 0) {
        return Response.json({ error: 'owner, repo, and files array are required' }, { status: 400 });
      }

      const targetBranch = branch || 'main';
      const message = commitMessage || `Update from NeonTrade AI - ${new Date().toISOString()}`;

      // Get the latest commit SHA for the branch
      const refResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${targetBranch}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (!refResp.ok) {
        const err = await refResp.text();
        return Response.json({ error: `Failed to get branch ref: ${err}` }, { status: refResp.status });
      }
      const refData = await refResp.json();
      const latestCommitSha = refData.object.sha;

      // Get the tree SHA of the latest commit
      const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (!commitResp.ok) {
        return Response.json({ error: 'Failed to get latest commit' }, { status: commitResp.status });
      }
      const commitData = await commitResp.json();
      const baseTreeSha = commitData.tree.sha;

      // Create blobs for each file
      const treeItems = [];
      for (const file of files) {
        const blobResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            content: file.content,
            encoding: 'utf-8'
          })
        });
        if (!blobResp.ok) {
          return Response.json({ error: `Failed to create blob for ${file.path}` }, { status: blobResp.status });
        }
        const blobData = await blobResp.json();
        treeItems.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha
        });
      }

      // Create a new tree
      const treeResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems
        })
      });
      if (!treeResp.ok) {
        return Response.json({ error: 'Failed to create tree' }, { status: treeResp.status });
      }
      const treeData = await treeResp.json();

      // Create the commit
      const newCommitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          tree: treeData.sha,
          parents: [latestCommitSha]
        })
      });
      if (!newCommitResp.ok) {
        return Response.json({ error: 'Failed to create commit' }, { status: newCommitResp.status });
      }
      const newCommitData = await newCommitResp.json();

      // Update the branch reference
      const updateRefResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${targetBranch}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sha: newCommitData.sha
        })
      });
      if (!updateRefResp.ok) {
        return Response.json({ error: 'Failed to update branch' }, { status: updateRefResp.status });
      }

      return Response.json({
        success: true,
        commit: {
          sha: newCommitData.sha,
          message: newCommitData.message,
          url: newCommitData.html_url,
          files_pushed: files.length
        }
      });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});