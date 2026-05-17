import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { githubRepo } from "@/functions/githubRepo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Github, Plus, ExternalLink, Lock, Globe, RefreshCw, LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";

const CONNECTOR_ID = '6a09f1308b3ef44f133e022c';

export default function GitHubConnect() {
  const [user, setUser] = useState(null);
  const [connected, setConnected] = useState(false);
  const [ghUser, setGhUser] = useState(null);
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reposLoading, setReposLoading] = useState(false);

  // Create repo form
  const [showCreate, setShowCreate] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [repoDesc, setRepoDesc] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [userRes, reposRes] = await Promise.all([
        githubRepo({ action: 'getUser' }),
        githubRepo({ action: 'listRepos' })
      ]);
      const uData = userRes?.data || userRes;
      const rData = reposRes?.data || reposRes;
      if (uData?.success) setGhUser(uData.user);
      if (rData?.success) setRepos(rData.repos || []);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    base44.auth.isAuthenticated().then(async (authed) => {
      if (authed) {
        const me = await base44.auth.me();
        setUser(me);
        await fetchData();
      }
      setLoading(false);
    });
  }, [fetchData]);

  const handleConnect = async () => {
    const url = await base44.connectors.connectAppUser(CONNECTOR_ID);
    const popup = window.open(url, "_blank");
    const timer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        setLoading(true);
        fetchData().finally(() => setLoading(false));
      }
    }, 500);
  };

  const handleDisconnect = async () => {
    await base44.connectors.disconnectAppUser(CONNECTOR_ID);
    setConnected(false);
    setGhUser(null);
    setRepos([]);
    toast.success("GitHub disconnected");
  };

  const handleCreateRepo = async (e) => {
    e.preventDefault();
    if (!repoName.trim()) return toast.error("Repository name is required");
    setCreating(true);
    try {
      const res = await githubRepo({ action: 'createRepo', name: repoName.trim(), description: repoDesc, isPrivate });
      const data = res?.data || res;
      if (data?.success) {
        toast.success(`Repository "${data.repo.name}" created!`);
        setRepoName('');
        setRepoDesc('');
        setShowCreate(false);
        // Refresh repos
        setReposLoading(true);
        const rRes = await githubRepo({ action: 'listRepos' });
        const rData = rRes?.data || rRes;
        if (rData?.success) setRepos(rData.repos || []);
        setReposLoading(false);
      } else {
        toast.error(data?.error || "Failed to create repo");
      }
    } catch (err) {
      toast.error(err?.message || "Failed to create repo");
    }
    setCreating(false);
  };

  const refreshRepos = async () => {
    setReposLoading(true);
    try {
      const res = await githubRepo({ action: 'listRepos' });
      const data = res?.data || res;
      if (data?.success) setRepos(data.repos || []);
    } catch {}
    setReposLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--neon-green)' }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <Github className="w-16 h-16 text-gray-400" />
        <p style={{ color: 'var(--text-secondary)' }}>Please log in to connect your GitHub account.</p>
        <Button onClick={() => base44.auth.redirectToLogin()}>Log In</Button>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-6">
        <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(var(--neon-green-rgb), 0.1)' }}>
          <Github className="w-10 h-10" style={{ color: 'var(--neon-green)' }} />
        </div>
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Connect GitHub</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Link your GitHub account to create repositories, manage code, and more.
          </p>
        </div>
        <Button onClick={handleConnect} className="gap-2 px-6 py-3 text-lg" style={{ backgroundColor: 'var(--neon-green)', color: '#000' }}>
          <Github className="w-5 h-5" />
          Connect GitHub
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 pb-32">
      {/* GitHub User Info */}
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader className="flex flex-row items-center gap-4">
          {ghUser?.avatar_url && (
            <img src={ghUser.avatar_url} alt={ghUser.login} className="w-12 h-12 rounded-full" />
          )}
          <div className="flex-1">
            <CardTitle style={{ color: 'var(--text-primary)' }}>
              {ghUser?.name || ghUser?.login}
            </CardTitle>
            <CardDescription style={{ color: 'var(--text-secondary)' }}>
              @{ghUser?.login} · {ghUser?.public_repos} public repos
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={ghUser?.html_url} target="_blank" rel="noopener noreferrer" className="gap-1">
                <ExternalLink className="w-3.5 h-3.5" /> Profile
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDisconnect} className="text-red-500 hover:text-red-400 gap-1">
              <LogOut className="w-3.5 h-3.5" /> Disconnect
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Create Repo */}
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg" style={{ color: 'var(--text-primary)' }}>Create New Repository</CardTitle>
          {!showCreate && (
            <Button size="sm" className="gap-1" style={{ backgroundColor: 'var(--neon-green)', color: '#000' }} onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> New Repo
            </Button>
          )}
        </CardHeader>
        {showCreate && (
          <CardContent>
            <form onSubmit={handleCreateRepo} className="space-y-4">
              <div>
                <Label style={{ color: 'var(--text-secondary)' }}>Repository Name *</Label>
                <Input
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="my-awesome-project"
                  className="mt-1"
                  style={{ backgroundColor: 'var(--secondary-bg)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
                />
              </div>
              <div>
                <Label style={{ color: 'var(--text-secondary)' }}>Description</Label>
                <Input
                  value={repoDesc}
                  onChange={(e) => setRepoDesc(e.target.value)}
                  placeholder="A short description of your project"
                  className="mt-1"
                  style={{ backgroundColor: 'var(--secondary-bg)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                <Label className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {isPrivate ? <Lock className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                  {isPrivate ? 'Private' : 'Public'}
                </Label>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={creating} className="gap-1" style={{ backgroundColor: 'var(--neon-green)', color: '#000' }}>
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create Repository
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        )}
      </Card>

      {/* Repos List */}
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg" style={{ color: 'var(--text-primary)' }}>Your Repositories</CardTitle>
          <Button variant="ghost" size="sm" onClick={refreshRepos} disabled={reposLoading} className="gap-1">
            <RefreshCw className={`w-4 h-4 ${reposLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {repos.length === 0 ? (
            <p className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>No repositories found.</p>
          ) : (
            <div className="space-y-3">
              {repos.map((repo) => (
                <a
                  key={repo.id}
                  href={repo.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-lg border hover:opacity-80 transition-opacity"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--secondary-bg)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{repo.name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {repo.private ? <><Lock className="w-3 h-3 mr-1" />Private</> : <><Globe className="w-3 h-3 mr-1" />Public</>}
                      </Badge>
                      {repo.language && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">{repo.language}</Badge>
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{repo.description}</p>
                    )}
                  </div>
                  <ExternalLink className="w-4 h-4 shrink-0 ml-2" style={{ color: 'var(--text-secondary)' }} />
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}