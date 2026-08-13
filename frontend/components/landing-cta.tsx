"use client";

import { motion, useReducedMotion } from "motion/react";

import styles from "./initia-landing.module.css";

const SPRING = {type:"spring",stiffness:420,damping:26,mass:.9} as const;
const button = {rest:{scale:1},hover:{scale:1},tap:{scale:.95}};
const label = {rest:{x:0},hover:{x:-8}};
const arrow = {rest:{x:0,opacity:0},hover:{x:32,opacity:1}};

export function Cta({href,children}:{href:string;children:string}){
  const reduce = useReducedMotion();
  const transition = reduce ? {duration:0} : SPRING;
  const external = href.startsWith("http");
  return <motion.a className={styles.cta} href={href} target={external?"_blank":undefined} rel={external?"noreferrer":undefined} variants={button} initial="rest" animate="rest" whileHover="hover" whileFocus="hover" whileTap="tap" transition={transition}>
    <motion.span variants={label} transition={transition}>{children}</motion.span>
    <motion.svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" variants={arrow} transition={transition}><path d="M12 7 0 .072v13.856L12 7Z"/></motion.svg>
  </motion.a>;
}
