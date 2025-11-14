import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { getMarketData } from "@/functions/getMarketData";

export default function AssetAbout({ symbol }) {
  const [details, setDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    
    const fetchDetails = async () => {
      setIsLoading(true);
      try {
        const { data } = await getMarketData({
          action: 'getAssetDetails',
          payload: { symbol, assetType: 'crypto' } // Assuming crypto
        });
        setDetails(data);
      } catch (error) {
        console.error('Failed to fetch asset details:', error);
      }
      setIsLoading(false);
    };

    fetchDetails();
  }, [symbol]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex justify-center items-center">
          <Loader2 className="w-8 h-8 animate-spin neon-text" />
        </CardContent>
      </Card>
    );
  }

  if (!details) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <p>Information not available for this asset.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle>About {details.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p 
          className="text-sm prose dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: details.description || 'No description available.' }} 
        />

        {details.links && (
          <div>
            <h4 className="font-semibold mb-2">Official Links</h4>
            <div className="flex flex-wrap gap-4">
              {details.links.homepage?.[0] && <a href={details.links.homepage[0]} target="_blank" rel="noreferrer" className="text-sm neon-text hover:underline">Website</a>}
              {details.links.blockchain_site?.[0] && <a href={details.links.blockchain_site[0]} target="_blank" rel="noreferrer" className="text-sm neon-text hover:underline">Explorer</a>}
              {details.links.official_forum_url?.[0] && <a href={details.links.official_forum_url[0]} target="_blank" rel="noreferrer" className="text-sm neon-text hover:underline">Forum</a>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}