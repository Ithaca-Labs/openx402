"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import styles from "./initia-landing.module.css";

const SPRING = {type:"spring",stiffness:260,damping:30,mass:1} as const;
const card = {rest:{scale:1},hover:{scale:1},tap:{scale:.99}};
const image = {rest:{scale:1},hover:{scale:1.025}};

function PixelGlyph({className=""}:{className?:string}){return <svg aria-hidden="true" className={className} viewBox="0 0 48 48" fill="currentColor"><path d="M20 2h8v4h-8zM16 6h16v4H16zM12 10h8v4h-8zM28 10h8v4h-8zM8 14h8v4H8zM32 14h8v4h-8zM4 18h8v12H4zM36 18h8v12h-8zM8 30h8v4H8zM32 30h8v4h-8zM12 34h8v4h-8zM28 34h8v4h-8zM16 38h16v4H16zM20 42h8v4h-8zM18 18h12v12H18z"/></svg>}

// card hover styling only exists at >=1280px, so gate the spring to match
function useWideHover(){
  const [wide,setWide] = useState(false);
  useEffect(()=>{
    const mq = window.matchMedia("(min-width:1280px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change",sync);
    return () => mq.removeEventListener("change",sync);
  },[]);
  return wide;
}

export function FeatureCard({title,src,href,tone}:{title:string;src:string;href:string;tone:"discover"|"economy"}){
  const reduce = useReducedMotion();
  const wide = useWideHover();
  const transition = reduce ? {duration:0} : SPRING;
  return <motion.a className={`${styles.featureCard} ${styles[`featureCard--${tone}`]}`} href={href} variants={card} initial="rest" animate="rest" whileHover={wide?"hover":undefined} whileFocus={wide?"hover":undefined} whileTap="tap" transition={transition}>
    <span className={styles.featureFront}>
      <motion.img src={src} alt="" variants={image} transition={transition}/>
      <span className={styles.featureShade}/>
      <PixelGlyph className={styles.featureGlyph}/>
      <span className={styles.featureTitle}><em>openx402</em><strong>{title}</strong></span>
    </span>
  </motion.a>;
}
