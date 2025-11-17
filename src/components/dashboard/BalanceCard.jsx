import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, EyeOff, TrendingUp, TrendingDown, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import NumberDisplay from "@/components/ui/NumberDisplay";

export default function BalanceCard({
  title,
  amount,
  change,
  icon: Icon,
  onToggleVisibility,
  isVisible,
  isPrimary = false,
  changeLabel,
  isSimMode = true,
  isConnected = false
}) {
  // CRITICAL: Use amount directly - no caching, no refs
  const displayAmount = typeof amount === 'number' ? amount : 0;
  const displayChange = change || { value: 0, percentage: 0 };

  const isPositive = displayChange.value >= 0;
  const changeValue = typeof displayChange.value === 'number' ? displayChange.value : 0;
  const changePct = typeof displayChange.percentage === 'number' ? displayChange.percentage : 0;

  return (
    <Card className={`border-2 transition-all duration-300 ${
      isPrimary ?
      'neon-glow' :
      'border-gray-200 dark:border-gray-700 hover:border-green-400'}`
    }
    style={{ backgroundColor: 'var(--card-bg)', borderColor: isPrimary ? 'var(--neon-green)' : 'var(--border-color)' }}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {title}
            </h3>
            {isSimMode &&
              <Badge variant="outline" className="text-xs">
                Demo
              </Badge>
            }
            {!isSimMode &&
              <Badge className="bg-green-100 text-green-800 text-xs flex items-center gap-1">
                {isConnected && <Wifi className="w-3 h-3" />}
                Live
              </Badge>
            }
          </div>
          <div className="flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4" style={{ color: 'var(--neon-green)' }} />}
            {onToggleVisibility &&
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 p-0"
                onClick={onToggleVisibility}>
                {isVisible ?
                  <EyeOff className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> :
                  <Eye className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                }
              </Button>
            }
          </div>
        </div>
        
        <div className="space-y-1">
          {isVisible ? (
            <>
              <NumberDisplay
                value={displayAmount}
                prefix="$"
                decimals={2}
                className={`max-w-full ${isPrimary ? 'neon-text' : ''}`}
                maxFontSize={isPrimary ? 40 : 28}
                minFontSize={16}
              />
            </>
          ) : (
            <p className={`text-2xl font-bold ${isPrimary ? 'neon-text' : ''}`}
              style={{ color: isPrimary ? 'var(--neon-green)' : 'var(--text-primary)' }}>
              ••••••
            </p>
          )}
          
          {isVisible &&
            <div className="flex items-center gap-1 flex-wrap">
              {isPositive ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                {(changeValue >= 0 ? '+' : '-')}${Math.abs(changeValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({changePct >= 0 ? '+' : '-'}{Math.abs(changePct).toFixed(2)}%)
              </span>
              <span className="text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>
                {changeLabel || (isSimMode ? 'Demo' : 'Live')}
              </span>
            </div>
          }
        </div>
      </CardContent>
    </Card>
  );
}