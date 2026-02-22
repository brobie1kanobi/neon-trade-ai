{selectedNotification?.details_json &&
  <div className="bg-gray-50 dark:bg-slate-900 p-3 rounded-md border border-gray-100 dark:border-gray-800 space-y-2">
    {(() => {
      try {
        const details =
          typeof selectedNotification.details_json === "string"
            ? JSON.parse(selectedNotification.details_json)
            : selectedNotification.details_json;

        const safeNumber = (val, digits = 2) => {
          const num = Number(val);
          return isNaN(num) ? null : num.toFixed(digits);
        };

        const sym = details.symbol || details.trade?.symbol;
        const action = details.action || details.side || details.orderType || details.trade?.type;
        const qty = details.quantity || details.trade?.quantity;
        const px = details.price || details.fillPrice || details.purchasePrice || details.trade?.price;
        const total = details.total_value || details.cost || details.trade?.total_value;

        const hasStructuredData =
          sym ||
          action ||
          qty != null ||
          px != null ||
          total != null ||
          details.pnl != null ||
          details.fee != null ||
          details.tp_price ||
          details.sl_pct ||
          details.confidence ||
          details.mode ||
          details.error;

        return (
          <div className="space-y-1.5">

            {sym &&
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Asset:</span>
                <span className="font-medium text-gray-300">{sym}</span>
              </div>
            }

            {action &&
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Action:</span>
                <span className={`font-medium ${
                  action === 'buy' ? 'text-green-400' :
                  action === 'sell' ? 'text-red-400' :
                  action === 'take-profit' ? 'text-green-400' :
                  action === 'stop-loss' ? 'text-red-400' :
                  'text-gray-300'
                }`}>
                  {action === 'take-profit'
                    ? 'Take Profit'
                    : action === 'stop-loss'
                    ? 'Stop Loss'
                    : String(action).toUpperCase()}
                </span>
              </div>
            }

            {qty != null &&
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Quantity:</span>
                <span className="font-medium text-gray-300">
                  {typeof qty === 'number' ? qty.toFixed(6) : qty}
                </span>
              </div>
            }

            {safeNumber(px) &&
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Price:</span>
                <span className="font-medium text-gray-300">
                  ${safeNumber(px)}
                </span>
              </div>
            }

            {safeNumber(total) &&
              <div className="flex justify-between text-sm border-t border-gray-700 pt-1.5 mt-1.5">
                <span className="text-gray-500 font-medium">Total Spent:</span>
                <span className="font-semibold text-lime-400">
                  ${safeNumber(total)}
                </span>
              </div>
            }

            {details.pnl != null && safeNumber(details.pnl) &&
              <div className="flex justify-between text-sm border-t border-gray-700 pt-1.5 mt-1.5">
                <span className="text-gray-500 font-medium">Profit/Loss:</span>
                <span className={`font-semibold ${
                  Number(details.pnl) >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {Number(details.pnl) >= 0 ? '+' : ''}${safeNumber(details.pnl)}
                  {details.pnlPct
                    ? ` (${Number(details.pnlPct) >= 0 ? '+' : ''}${details.pnlPct}%)`
                    : ''}
                </span>
              </div>
            }

            {details.fee != null && safeNumber(details.fee) &&
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Fee:</span>
                <span className="font-medium text-orange-400">
                  -${safeNumber(details.fee)}
                </span>
              </div>
            }

            {details.tp_price && safeNumber(details.tp_price) &&
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Take Profit:</span>
                <span className="font-medium text-green-400">
                  ${safeNumber(details.tp_price)}
                  {details.tp_pct ? ` (+${details.tp_pct}%)` : ''}
                </span>
              </div>
            }

            {details.sl_pct &&
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Stop Loss:</span>
                <span className="font-medium text-red-400">
                  -{details.sl_pct}%{details.trailing ? ' (trailing)' : ''}
                </span>
              </div>
            }

            {details.confidence &&
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">AI Confidence:</span>
                <span className="font-medium text-blue-400">
                  {details.confidence}%
                </span>
              </div>
            }

            {details.mode &&
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Mode:</span>
                <span className={`font-medium ${
                  details.mode === 'LIVE'
                    ? 'text-green-400'
                    : 'text-yellow-400'
                }`}>
                  {details.mode}
                </span>
              </div>
            }

            {details.error &&
              <div className="pt-2 border-t border-gray-700">
                <p className="text-xs text-red-400">{details.error}</p>
              </div>
            }

            {!hasStructuredData &&
              <pre className="text-xs text-gray-400 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(details, null, 2)}
              </pre>
            }

          </div>
        );

      } catch (e) {
        return (
          <pre className="text-xs overflow-auto whitespace-pre-wrap text-gray-400 max-h-[200px]">
            {selectedNotification.details_json}
          </pre>
        );
      }
    })()}
  </div>
}