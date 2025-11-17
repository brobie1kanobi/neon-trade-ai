import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnimatePresence, motion } from "framer-motion";
import AssetAbout from "./AssetAbout";
import AssetBalance from "./AssetBalance";
import AssetInsights from "./AssetInsights";

export default function AssetInfoTabs({ assetData, holding }) {
  const [activeTab, setActiveTab] = useState("balance");

  const tabContent = {
    balance: <AssetBalance holding={holding} assetData={assetData} />,
    insights: <AssetInsights symbol={assetData.symbol} name={assetData.name} />,
    about: <AssetAbout symbol={assetData.symbol} />,
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-3" style={{ backgroundColor: 'var(--secondary-bg)' }}>
        <TabsTrigger value="balance">Balance</TabsTrigger>
        <TabsTrigger value="insights">Insights</TabsTrigger>
        <TabsTrigger value="about">About</TabsTrigger>
      </TabsList>
      
      <div className="mt-4 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="space-y-4"
          >
            {tabContent[activeTab]}
          </motion.div>
        </AnimatePresence>
      </div>
    </Tabs>
  );
}