import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const LongPressTooltip = ({ children, content, ...props }) => {
  const [isOpen, setIsOpen] = useState(false);
  const timerRef = useRef(null);
  const isTouchDeviceRef = useRef(false);

  useEffect(() => {
    isTouchDeviceRef.current = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }, []);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleTouchStart = useCallback(() => {
    if (isTouchDeviceRef.current) {
      handleClose(); // Close any existing tooltip
      timerRef.current = setTimeout(() => {
        handleOpen();
      }, 500); // 500ms for long press
    }
  }, [handleOpen, handleClose]);

  const handleTouchEnd = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleContextMenu = useCallback((e) => {
    if (isTouchDeviceRef.current && isOpen) {
      e.preventDefault(); // Prevent context menu on long press if tooltip is open
    }
  }, [isOpen]);
  
  // For PC hover behavior
  const handleMouseEnter = () => {
    if (!isTouchDeviceRef.current) {
        setIsOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (!isTouchDeviceRef.current) {
        setIsOpen(false);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip open={isOpen} onOpenChange={setIsOpen}>
        <TooltipTrigger
          asChild
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchEnd} // Cancel on move
          onContextMenu={handleContextMenu}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent {...props}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};