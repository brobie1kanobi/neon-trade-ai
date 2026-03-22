import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// This file is now deprecated and will be removed.
// All calls should go directly to 'getMarketData'.

Deno.serve((req) => {
  return new Response("This function is deprecated. Please use 'getMarketData' directly.", { status: 410 });
});