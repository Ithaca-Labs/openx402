"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

import styles from "./initia-landing.module.css";

const GLYPHS = " .:xX|0#";
const LINK_LAYOUT = [
  { position: [-4.3, -0.65, 0.35], rotation: [0.45, -0.08] },
  { position: [-2.15, 0.25, -0.5], rotation: [-0.58, 0.05] },
  { position: [0, -0.45, 0.55], rotation: [0.52, -0.03] },
  { position: [2.15, 0.4, -0.48], rotation: [-0.55, 0.06] },
  { position: [4.3, -0.2, 0.35], rotation: [0.48, -0.04] },
] as const;

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uScene;
  uniform sampler2D uGlyphAtlas;
  uniform vec2 uResolution;
  uniform vec2 uGridSize;
  uniform float uGlyphCount;
  varying vec2 vUv;

  void main() {
    vec2 cellSize = uResolution / uGridSize;
    vec2 cell = floor(gl_FragCoord.xy / cellSize);
    vec2 sceneUv = (cell + 0.5) / uGridSize;
    vec3 shaded = texture2D(uScene, sceneUv).rgb;
    float luminance = dot(shaded, vec3(0.2126, 0.7152, 0.0722));
    float density = clamp(pow(luminance, 0.82) * 1.18, 0.0, 0.9999);
    float glyph = floor(density * uGlyphCount);
    vec2 glyphUv = vec2(
      (glyph + fract(gl_FragCoord.x / cellSize.x)) / uGlyphCount,
      fract(gl_FragCoord.y / cellSize.y)
    );
    float glyphAlpha = texture2D(uGlyphAtlas, glyphUv).a;
    float surfaceAlpha = smoothstep(0.025, 0.16, luminance);
    float alpha = glyphAlpha * surfaceAlpha;

    gl_FragColor = vec4(vec3(0.72), alpha);
  }
`;

function createGlyphAtlas() {
  const glyphSize = 32;
  const canvas = document.createElement("canvas");
  canvas.width = glyphSize * GLYPHS.length;
  canvas.height = glyphSize;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the ASCII glyph atlas");

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.font = '600 25px "IBM Plex Mono", monospace';
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (let index = 0; index < GLYPHS.length; index += 1) {
    context.fillText(GLYPHS[index], index * glyphSize + glyphSize / 2, glyphSize / 2 + 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createChain() {
  const group = new THREE.Group();
  const geometry = new THREE.TorusGeometry(0.65, 0.21, 8, 20);
  geometry.scale(1.55, 1, 1);

  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  LINK_LAYOUT.forEach(({ position, rotation }) => {
    const link = new THREE.Mesh(geometry, material);
    link.position.set(position[0], position[1], position[2]);
    link.rotation.set(rotation[0], 0, rotation[1]);
    group.add(link);
  });

  group.rotation.z = -0.08;
  return { geometry, group, material };
}

export function AsciiChainBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        canvas,
        powerPreference: "low-power",
        premultipliedAlpha: false,
      });
    } catch {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
    camera.position.set(0, 0, 22);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.32);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(-4, 7, 8);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
    rimLight.position.set(7, -3, -5);
    scene.add(ambientLight, keyLight, rimLight);

    const { geometry, group: chain, material } = createChain();
    scene.add(chain);

    const atlas = createGlyphAtlas();
    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      stencilBuffer: false,
    });
    renderTarget.texture.colorSpace = THREE.NoColorSpace;
    renderTarget.texture.generateMipmaps = false;

    const postScene = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      fragmentShader,
      transparent: true,
      uniforms: {
        uGlyphAtlas: { value: atlas },
        uGlyphCount: { value: GLYPHS.length },
        uGridSize: { value: new THREE.Vector2(1, 1) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uScene: { value: renderTarget.texture },
      },
      vertexShader,
    });
    const postGeometry = new THREE.PlaneGeometry(2, 2);
    const postQuad = new THREE.Mesh(postGeometry, postMaterial);
    postScene.add(postQuad);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const drawingSize = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const pointerCurrent = new THREE.Vector2();
    let animationFrame = 0;
    let contextAvailable = true;
    let documentVisible = document.visibilityState === "visible";
    let firstFrame = true;
    let frameDuration = 1000 / 24;
    let heroVisible = true;
    let lastMotionAt = 0;
    let lastRenderAt = 0;
    let staticMotion = reducedMotion.matches;
    let motionTime = staticMotion ? 4.5 : 0;

    const resize = () => {
      const { height, width } = root.getBoundingClientRect();
      if (!width || !height) return;

      const mobile = window.innerWidth < 640;
      const tablet = !mobile && window.innerWidth < 1024;
      const cellSize = mobile ? 10 : 9;
      const pixelRatio = mobile
        ? 1
        : tablet
          ? Math.min(window.devicePixelRatio, 1.1)
          : Math.min(window.devicePixelRatio, 1.25);

      frameDuration = 1000 / (mobile ? 18 : tablet ? 20 : 24);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      renderer.getDrawingBufferSize(drawingSize);

      const columns = Math.max(1, Math.floor(drawingSize.x / (cellSize * pixelRatio)));
      const rows = Math.max(1, Math.floor(drawingSize.y / (cellSize * pixelRatio)));
      renderTarget.setSize(columns, rows);
      postMaterial.uniforms.uGridSize.value.set(columns, rows);
      postMaterial.uniforms.uResolution.value.copy(drawingSize);

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      chain.scale.setScalar(mobile ? 1.9 : tablet ? 2.25 : 2.5);
      chain.position.x = mobile ? -0.8 : -0.3;

      render(performance.now(), false);
    };

    const render = (timestamp: number, animate: boolean) => {
      if (!contextAvailable) return;

      if (animate) {
        const delta = lastMotionAt ? Math.min((timestamp - lastMotionAt) / 1000, 0.1) : 0;
        motionTime += delta;
        lastMotionAt = timestamp;
        pointerCurrent.lerp(pointerTarget, 0.03);
      }

      chain.rotation.x = -0.12 + motionTime * 0.1 + pointerCurrent.x;
      chain.rotation.y = -0.08;
      chain.position.y = -0.9 + Math.sin(motionTime * 0.3) * 0.08;

      renderer.setRenderTarget(renderTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);

      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(postScene, postCamera);

      if (firstFrame) {
        firstFrame = false;
        root.dataset.ready = "true";
      }
    };

    const tick = (timestamp: number) => {
      animationFrame = 0;
      if (!heroVisible || !documentVisible || staticMotion || !contextAvailable) return;

      if (timestamp - lastRenderAt >= frameDuration) {
        render(timestamp, true);
        lastRenderAt = timestamp;
      }
      animationFrame = requestAnimationFrame(tick);
    };

    const syncAnimation = () => {
      if (heroVisible && documentVisible && !staticMotion && contextAvailable) {
        lastMotionAt = 0;
        if (!animationFrame) animationFrame = requestAnimationFrame(tick);
      } else if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    };

    const handlePointer = (event: PointerEvent) => {
      if (!finePointer.matches || staticMotion) return;
      pointerTarget.set(
        THREE.MathUtils.clamp((event.clientY / window.innerHeight - 0.5) * 0.08, -0.04, 0.04),
        THREE.MathUtils.clamp((event.clientX / window.innerWidth - 0.5) * 0.08, -0.04, 0.04),
      );
    };

    const handleMotionPreference = () => {
      staticMotion = reducedMotion.matches;
      pointerTarget.set(0, 0);
      pointerCurrent.set(0, 0);
      if (staticMotion) render(performance.now(), false);
      syncAnimation();
    };

    const handleVisibility = () => {
      documentVisible = document.visibilityState === "visible";
      syncAnimation();
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      contextAvailable = false;
      root.dataset.ready = "false";
      syncAnimation();
    };

    const handleContextRestored = () => {
      contextAvailable = true;
      firstFrame = true;
      resize();
      syncAnimation();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      syncAnimation();
    });
    intersectionObserver.observe(root);

    window.addEventListener("pointermove", handlePointer, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    reducedMotion.addEventListener("change", handleMotionPreference);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    resize();
    syncAnimation();

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", handlePointer);
      document.removeEventListener("visibilitychange", handleVisibility);
      reducedMotion.removeEventListener("change", handleMotionPreference);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      geometry.dispose();
      material.dispose();
      postGeometry.dispose();
      postMaterial.dispose();
      atlas.dispose();
      renderTarget.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, []);

  return (
    <div aria-hidden="true" className={styles.heroArt} data-ready="false" ref={rootRef}>
      <canvas className={styles.heroArtCanvas} ref={canvasRef} />
    </div>
  );
}
