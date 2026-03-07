"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const COLS = 8;
const ROWS = 6;

export function PixelTransition({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const prevPath = useRef(pathname);
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (pathname === prevPath.current || !overlayRef.current) return;
        prevPath.current = pathname;

        const el = overlayRef.current;

        // Build candle grid HTML directly - Optimized and subtle
        let html = "";
        for (let col = 0; col < COLS; col++) {
            const colLeft = (col / COLS) * 100;
            const colWidth = 100 / COLS + 0.1;
            let cellsHtml = "";
            for (let row = 0; row < ROWS; row++) {
                const isUp = Math.random() > 0.5;
                const color = isUp ? "#00E676" : "#FF3B3B";
                const bodyHeight = 30 + Math.random() * 30; // 30-60%
                const wickHeight = 70 + Math.random() * 20; // 70-90%

                cellsHtml += `
          <div style="flex:1; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
            <div style="position:absolute; width:1px; height:${wickHeight}%; background:${color}; opacity:0.15;"></div>
            <div style="width:40%; height:${bodyHeight}%; background:${color}; border-radius:1px; opacity:0.6; box-shadow: 0 0 8px ${color}33;"></div>
          </div>
        `;
            }
            const delay = col * 20;
            html += `<div class="px-col" style="position:absolute;left:${colLeft}%;width:${colWidth}%;top:0;height:100%;display:flex;flex-direction:column;transform:translateY(-101%);animation:pxDrop 300ms ${delay}ms cubic-bezier(0.4,0,0.2,1) forwards">${cellsHtml}</div>`;
        }

        el.innerHTML = html;
        el.style.display = "block";

        // Phase 2: After drop completes → slide columns out downward
        const t1 = setTimeout(() => {
            const cols = el.querySelectorAll<HTMLElement>(".px-col");
            cols.forEach((c, i) => {
                // Pin at translateY(0) before swapping animation to prevent
                // snap-back to the initial inline translateY(-101%)
                c.style.transform = "translateY(0)";
                c.style.animation = `pxRise 300ms ${i * 20}ms cubic-bezier(0.4,0,0.2,1) both`;
            });
        }, 500);

        // Phase 3: Cleanup
        const t2 = setTimeout(() => {
            el.style.display = "none";
            el.innerHTML = "";
        }, 1000);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, [pathname]);

    return (
        <>
            {children}
            <div
                ref={overlayRef}
                style={{
                    display: "none",
                    position: "fixed",
                    inset: 0,
                    zIndex: 9999,
                    pointerEvents: "none",
                    overflow: "hidden",
                    background: "transparent"
                }}
            />
        </>
    );
}
