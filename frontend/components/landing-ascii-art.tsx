"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./initia-landing.module.css";

export function LandingAsciiArt({ src }: { src: string }) {
  const artRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;

    let isVisible = false;
    const updatePlayback = () => {
      setIsPlaying(isVisible && document.visibilityState === "visible");
    };
    const observer = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      updatePlayback();
    });

    observer.observe(art);
    document.addEventListener("visibilitychange", updatePlayback);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", updatePlayback);
    };
  }, []);

  return (
    <div
      ref={artRef}
      className={`${styles.heroArt} ${isPlaying ? styles.heroArtPlaying : ""}`}
      aria-hidden="true"
    >
      <div className={styles.heroArtCanvas}>
        <img src={src} alt="" draggable="false" />
        <img className={styles.heroArtSignal} src={src} alt="" draggable="false" />
      </div>
    </div>
  );
}
