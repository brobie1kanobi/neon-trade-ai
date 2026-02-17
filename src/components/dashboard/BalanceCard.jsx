import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, EyeOff, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import NumberDisplay from "@/components/ui/NumberDisplay";
import { Link } from "react-router-dom";

export default function BalanceCard({
  title,
  amount,
  change,
  icon: Icon,
  onToggleVisibility,
  isVisible,
  isPrimary = false,
  isSimMode = true,
  changeLabel,
  linkTo,
  isLoading = false
}) {
  // Use actual change data if provided, otherwise default to positive zero
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
              <Badge className="bg-green-100 text-green-800 text-xs">
                Live
              </Badge>
            }
          </div>
          <div className="flex items-center gap-2">
            {Icon && linkTo ? (
              <Link 
                to={linkTo}
                className="p-1 rounded border border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
              >
                <Icon className="w-4 h-4" style={{ color: 'var(--neon-green)' }} />
              </Link>
            ) : Icon ? (
              <Icon className="w-4 h-4" style={{ color: 'var(--neon-green)' }} />
            ) : null}
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
            <NumberDisplay
              value={typeof amount === 'number' ? amount : 0}
              prefix="$"
              decimals={2}
              className={`max-w-full ${isPrimary ? 'neon-text' : ''}`}
              maxFontSize={isPrimary ? 40 : 28}
              minFontSize={16}
            />
          ) : (
            <p className={`text-2xl font-bold ${isPrimary ? 'neon-text' : ''}`}
              style={{ color: isPrimary ? 'var(--neon-green)' : 'var(--text-primary)' }}>
              ••••••
            </p>
          )}
          
          {isVisible && amount !== null &&
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
                {changeLabel ? changeLabel : (isSimMode ? 'Demo Lifetime' : 'Live Lifetime')}
              </span>
            </div>
          }
        </div>
      </CardContent>
    </Card>
  );
}