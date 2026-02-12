import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  Pause,
  Play
} from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function SystemHealthPanel() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealth = async () => {
    try {
      const res = await base44.functions.invoke('systemHealthMonitor', {
        action: 'checkHealth'
      });
      const data = res?.data || res;
      setHealth(data);
    } catch (e) {
      console.error('Failed to fetch health:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchHealth();
  };

  const handleResume = async (component) => {
    try {
      await base44.functions.invoke('systemHealthMonitor', {
        action: 'resumeComponent',
        component
      });
      fetchHealth();
    } catch (e) {
      console.error('Failed to resume:', e);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'degraded':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'unhealthy':
      case 'paused':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status, isPaused) => {
    if (isPaused) {
      return <Badge className="bg-red-100 text-red-800">Paused</Badge>;
    }
    switch (status) {
      case 'healthy':
        return <Badge className="bg-green-100 text-green-800">Healthy</Badge>;
      case 'degraded':
        return <Badge className="bg-yellow-100 text-yellow-800">Degraded</Badge>;
      case 'unhealthy':
        return <Badge className="bg-red-100 text-red-800">Unhealthy</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-500">Loading health status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Activity className="w-5 h-5" />
          System Health
        </CardTitle>
        <div className="flex items-center gap-2">
          {health?.overall_status && getStatusBadge(health.overall_status, false)}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!health?.trading_allowed && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-medium">Trading is currently paused</span>
            </div>
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              One or more system components are experiencing issues.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {health?.components && Object.entries(health.components).map(([name, comp]) => (
            <div 
              key={name}
              className="flex items-center justify-between p-3 rounded-lg border"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--secondary-bg)' }}
            >
              <div className="flex items-center gap-3">
                {getStatusIcon(comp.status)}
                <div>
                  <p className="font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                    {name.replace(/_/g, ' ')}
                  </p>
                  {comp.error_count_1h > 0 && (
                    <p className="text-xs text-red-500">
                      {comp.error_count_1h} errors in last hour
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge(comp.status, comp.is_paused)}
                {comp.is_paused && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleResume(name)}
                  >
                    <Play className="w-3 h-3 mr-1" />
                    Resume
                  </Button>
                )}
              </div>
            </div>
          ))}

          {(!health?.components || Object.keys(health.components).length === 0) && (
            <div className="text-center py-4 text-gray-500">
              <p>No health data available</p>
              <p className="text-xs">Components will appear after first activity</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}