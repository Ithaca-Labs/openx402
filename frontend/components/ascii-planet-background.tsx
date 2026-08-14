"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

import styles from "./initia-landing.module.css";

const GLYPHS = " .:|x*o0O#";
const HIGHLIGHT_BANDS = [
  [2.92, 3.08],
  [3.28, 3.45],
  [3.68, 3.88],
  [4.12, 4.3],
  [4.57, 4.76],
  [4.98, 5.17],
] as const;

const VISUAL_CONFIG = {
  ambientIntensity: 0.012,
  asciiCellHeight: 10,
  asciiCellWidth: 8,
  cameraFov: 32,
  cameraZ: 14.25,
  keyIntensity: 4.2,
  keyPosition: [-4.8, 5.6, 7.5] as const,
  planetRadius: 2.63,
  ringInnerRadius: 2.78,
  ringOuterRadius: 5.46,
  ringRotationX: -1.435,
  ringRotationZ: 0.285,
  systemX: -0.22,
  systemY: -1.72,
} as const;

type MoonSpec = {
  base: readonly [number, number, number];
  brightness: number;
  orbitRadius: number;
  phase: number;
  radius: number;
  speed: number;
};

const MOONS: readonly MoonSpec[] = [
  { base: [1.62, 3.08, 0.55], brightness: 0.62, orbitRadius: 0.12, phase: 0.2, radius: 0.17, speed: 0.045 },
  { base: [4.85, 3.38, -0.15], brightness: 0.32, orbitRadius: 0.16, phase: 1.7, radius: 0.15, speed: -0.032 },
  { base: [-3.9, 0.75, 0.85], brightness: 0.58, orbitRadius: 0.1, phase: 2.5, radius: 0.16, speed: 0.038 },
  { base: [-4.65, 0.22, 1.15], brightness: 0.72, orbitRadius: 0.13, phase: 4.1, radius: 0.2, speed: -0.026 },
  { base: [4.86, 0.25, 0.4], brightness: 0.35, orbitRadius: 0.12, phase: 3.6, radius: 0.13, speed: 0.042 },
  { base: [3.82, -0.48, 1.05], brightness: 0.84, orbitRadius: 0.15, phase: 5.2, radius: 0.24, speed: -0.03 },
  { base: [0.88, -1.86, 1.2], brightness: 0.52, orbitRadius: 0.14, phase: 1.1, radius: 0.24, speed: 0.034 },
  { base: [4.5, -2.5, -0.25], brightness: 0.18, orbitRadius: 0.18, phase: 2.9, radius: 0.1, speed: -0.023 },
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

  float cellNoise(vec2 cell) {
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 cellSize = uResolution / uGridSize;
    vec2 cell = floor(gl_FragCoord.xy / cellSize);
    vec2 sceneUv = (cell + 0.5) / uGridSize;
    vec3 shaded = texture2D(uScene, sceneUv).rgb;
    float luminance = dot(shaded, vec3(0.2126, 0.7152, 0.0722));
    float variation = (cellNoise(cell) - 0.5) * 0.075;
    float density = clamp(pow(max(luminance - 0.002, 0.0), 0.54) * 1.16 + variation, 0.0, 0.9999);
    float glyph = floor(density * uGlyphCount);
    vec2 glyphUv = vec2(
      (glyph + fract(gl_FragCoord.x / cellSize.x)) / uGlyphCount,
      fract(gl_FragCoord.y / cellSize.y)
    );
    float glyphAlpha = texture2D(uGlyphAtlas, glyphUv).a;
    float surfaceAlpha = smoothstep(0.006, 0.062, luminance);
    float tone = mix(0.015, 1.0, pow(clamp(luminance * 1.42, 0.0, 1.0), 0.92));

    gl_FragColor = vec4(vec3(tone), glyphAlpha * surfaceAlpha);
  }
`;

function hash(value: number) {
  return Math.abs(Math.sin(value * 127.1 + 311.7) * 43758.5453) % 1;
}

function createGlyphAtlas() {
  const glyphSize = 36;
  const canvas = document.createElement("canvas");
  canvas.width = glyphSize * GLYPHS.length;
  canvas.height = glyphSize;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the ASCII glyph atlas");

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.font = '500 27px "IBM Plex Mono", monospace';
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
  return texture;
}

function createPlanetTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the planet texture");

  context.fillStyle = "#d0d0d0";
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y += 3) {
    const band = Math.sin(y * 0.17) * 13 + Math.sin(y * 0.047) * 17;
    const shade = Math.round(177 + band);
    context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
    context.fillRect(0, y, canvas.width, 2);
  }

  for (let index = 0; index < 92; index += 1) {
    const x = hash(index + 17) * canvas.width;
    const y = hash(index + 83) * canvas.height;
    const width = 10 + hash(index + 157) * 58;
    const height = 2 + hash(index + 241) * 9;
    const shade = Math.round(104 + hash(index + 337) * 62);
    context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
    context.fillRect(x, y, width, height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function ringBrightness(angle: number, radius: number, seed: number) {
  const front = 0.18 + 0.82 * (0.5 - 0.5 * Math.sin(angle));
  const radialStructure = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(radius * 22 + seed), 1.7);
  const gap = Math.sin(radius * 13.5 + seed * 0.7) > 0.82 ? 0.22 : 1;
  return THREE.MathUtils.clamp(front * radialStructure * gap, 0.025, 1);
}

function createRingGeometry() {
  const geometry = new THREE.RingGeometry(
    VISUAL_CONFIG.ringInnerRadius,
    VISUAL_CONFIG.ringOuterRadius,
    256,
    42,
  );
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const radius = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    const noise = 0.78 + hash(index + 401) * 0.22;
    const shade = ringBrightness(angle, radius, 0.7) * noise;
    colors[index * 3] = shade;
    colors[index * 3 + 1] = shade;
    colors[index * 3 + 2] = shade;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function createRingBandGeometry(innerRadius: number, outerRadius: number, seed: number) {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 256, 2);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);

  for (let index = 0; index < position.count; index += 1) {
    const angle = Math.atan2(position.getY(index), position.getX(index));
    const front = Math.pow(0.5 - 0.5 * Math.sin(angle), 2.25);
    const irregularity = 0.58 + hash(index + seed * 73) * 0.42;
    const shade = THREE.MathUtils.clamp(0.025 + front * irregularity, 0.025, 1);
    colors[index * 3] = shade;
    colors[index * 3 + 1] = shade;
    colors[index * 3 + 2] = shade;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function createRingAlphaTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the Saturn ring texture");

  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = ((x + 0.5) / size - 0.5) * 2;
      const dy = ((y + 0.5) / size - 0.5) * 2;
      const radius = Math.hypot(dx, dy) * VISUAL_CONFIG.ringOuterRadius;
      const structure =
        0.53 + Math.sin(radius * 18.5) * 0.26 + Math.sin(radius * 41.0 + 0.7) * 0.18;
      const dust = hash(x * 0.17 + y * 0.31 + 503);
      const alpha = structure > 0.49 || dust > 0.96 ? 255 : 0;
      const offset = (y * size + x) * 4;
      image.data[offset] = alpha;
      image.data[offset + 1] = alpha;
      image.data[offset + 2] = alpha;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createRingParticles() {
  const count = 520;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const angle = hash(index + 37) * Math.PI * 2;
    const radialMix = Math.pow(hash(index + 109), 0.86);
    const radius = THREE.MathUtils.lerp(
      VISUAL_CONFIG.ringInnerRadius + 0.03,
      VISUAL_CONFIG.ringOuterRadius - 0.03,
      radialMix,
    );
    const jitter = (hash(index + 181) - 0.5) * 0.045;
    const shade = ringBrightness(angle, radius, 2.1) * (0.56 + hash(index + 293) * 0.44);

    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius;
    positions[index * 3 + 2] = jitter;
    colors[index * 3] = shade;
    colors[index * 3 + 1] = shade;
    colors[index * 3 + 2] = shade;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    opacity: 0.46,
    size: 0.09,
    sizeAttenuation: true,
    transparent: true,
    vertexColors: true,
  });
  return { geometry, material, points: new THREE.Points(geometry, material) };
}

function createOrbitPath(
  radiusX: number,
  radiusY: number,
  rotationZ: number,
  zWave: number,
  seed: number,
) {
  const positions: number[] = [];
  const colors: number[] = [];
  const cos = Math.cos(rotationZ);
  const sin = Math.sin(rotationZ);

  for (let index = 0; index < 220; index += 1) {
    if (hash(index + seed * 31) > 0.34) continue;
    const angle = (index / 220) * Math.PI * 2;
    const localX = Math.cos(angle) * radiusX;
    const localY = Math.sin(angle) * radiusY;
    const intensity = 0.025 + hash(index + seed * 71) * 0.08;
    positions.push(
      localX * cos - localY * sin,
      localX * sin + localY * cos,
      Math.sin(angle) * zWave - 0.35,
    );
    colors.push(intensity, intensity, intensity);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    opacity: 0.62,
    size: 0.055,
    sizeAttenuation: true,
    transparent: true,
    vertexColors: true,
  });
  return { geometry, material, points: new THREE.Points(geometry, material) };
}

function createPlanetSystem() {
  const saturnSystem = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const planetTexture = createPlanetTexture();
  const planetGeometry = new THREE.SphereGeometry(VISUAL_CONFIG.planetRadius, 96, 64);
  const planetMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0x020202,
    emissiveIntensity: 0.08,
    map: planetTexture,
  });
  const planet = new THREE.Mesh(planetGeometry, planetMaterial);
  planet.rotation.z = -0.08;
  saturnSystem.add(planet);
  geometries.push(planetGeometry);
  materials.push(planetMaterial);
  textures.push(planetTexture);

  const ringGroup = new THREE.Group();
  ringGroup.rotation.z = VISUAL_CONFIG.ringRotationZ;
  const ringPlane = new THREE.Group();
  ringPlane.rotation.x = VISUAL_CONFIG.ringRotationX;
  ringGroup.add(ringPlane);

  const ringGeometry = createRingGeometry();
  const ringAlphaTexture = createRingAlphaTexture();
  const ringMaterial = new THREE.MeshBasicMaterial({
    alphaMap: ringAlphaTexture,
    alphaTest: 0.5,
    color: 0x787878,
    depthWrite: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    transparent: true,
    vertexColors: true,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ringPlane.add(ring);
  geometries.push(ringGeometry);
  materials.push(ringMaterial);
  textures.push(ringAlphaTexture);

  const ringBandMaterial = new THREE.MeshBasicMaterial({
    color: 0xf0f0f0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  HIGHLIGHT_BANDS.forEach(([innerRadius, outerRadius], index) => {
    const geometry = createRingBandGeometry(innerRadius, outerRadius, index + 1);
    ringPlane.add(new THREE.Mesh(geometry, ringBandMaterial));
    geometries.push(geometry);
  });
  materials.push(ringBandMaterial);

  const ringParticles = createRingParticles();
  ringParticles.points.renderOrder = 1;
  ringPlane.add(ringParticles.points);
  geometries.push(ringParticles.geometry);
  materials.push(ringParticles.material);
  saturnSystem.add(ringGroup);

  const moonGeometry = new THREE.SphereGeometry(1, 32, 20);
  const moonMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.025,
  });
  const moons = new THREE.InstancedMesh(moonGeometry, moonMaterial, MOONS.length);
  const moonColor = new THREE.Color();
  MOONS.forEach((moon, index) => moons.setColorAt(index, moonColor.setScalar(moon.brightness)));
  if (moons.instanceColor) moons.instanceColor.needsUpdate = true;
  moons.frustumCulled = false;
  saturnSystem.add(moons);
  geometries.push(moonGeometry);
  materials.push(moonMaterial);

  [
    createOrbitPath(6.2, 2.58, 0.09, 0.82, 13),
    createOrbitPath(6.55, 2.25, 0.31, 0.58, 29),
  ].forEach((orbit) => {
    saturnSystem.add(orbit.points);
    geometries.push(orbit.geometry);
    materials.push(orbit.material);
  });

  return {
    geometries,
    materials,
    moons,
    planet,
    ringGroup,
    ringParticles: ringParticles.points,
    saturnSystem,
    textures,
  };
}

export function AsciiPlanetBackground() {
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
    const camera = new THREE.PerspectiveCamera(VISUAL_CONFIG.cameraFov, 1, 0.1, 60);
    camera.position.set(0, 0, VISUAL_CONFIG.cameraZ);
    camera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, VISUAL_CONFIG.ambientIntensity);
    const keyLight = new THREE.DirectionalLight(0xffffff, VISUAL_CONFIG.keyIntensity);
    keyLight.position.set(...VISUAL_CONFIG.keyPosition);
    scene.add(ambientLight, keyLight);

    const celestial = createPlanetSystem();
    scene.add(celestial.saturnSystem);

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
    postScene.add(new THREE.Mesh(postGeometry, postMaterial));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const drawingSize = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const pointerCurrent = new THREE.Vector2();
    const dummy = new THREE.Object3D();
    let animationFrame = 0;
    let baseX: number = VISUAL_CONFIG.systemX;
    let baseY: number = VISUAL_CONFIG.systemY;
    let contextAvailable = true;
    let documentVisible = document.visibilityState === "visible";
    let firstFrame = true;
    let frameDuration = 1000 / 24;
    let heroVisible = true;
    let lastMotionAt = 0;
    let lastRenderAt = 0;
    let staticMotion = reducedMotion.matches;
    let motionTime = 4.8;

    const updateMoons = (time: number) => {
      MOONS.forEach((moon, index) => {
        const angle = moon.phase + time * moon.speed;
        dummy.position.set(
          moon.base[0] + Math.cos(angle) * moon.orbitRadius,
          moon.base[1] + Math.sin(angle) * moon.orbitRadius * 0.56,
          moon.base[2] + Math.sin(angle) * moon.orbitRadius * 0.35,
        );
        dummy.rotation.set(angle * 0.3, time * 0.04 + index, -angle * 0.17);
        dummy.scale.setScalar(moon.radius);
        dummy.updateMatrix();
        celestial.moons.setMatrixAt(index, dummy.matrix);
      });
      celestial.moons.instanceMatrix.needsUpdate = true;
    };

    const render = (timestamp: number, animate: boolean) => {
      if (!contextAvailable) return;

      if (animate) {
        const delta = lastMotionAt ? Math.min((timestamp - lastMotionAt) / 1000, 0.1) : 0;
        motionTime += delta;
        lastMotionAt = timestamp;
        pointerCurrent.lerp(pointerTarget, 0.025);
      }

      celestial.planet.rotation.y = motionTime * 0.082;
      celestial.ringGroup.rotation.z = VISUAL_CONFIG.ringRotationZ + Math.sin(motionTime * 0.2) * 0.009;
      celestial.ringParticles.rotation.z = motionTime * 0.052;
      celestial.saturnSystem.rotation.x = pointerCurrent.x;
      celestial.saturnSystem.rotation.y = pointerCurrent.y;
      celestial.saturnSystem.position.set(
        baseX,
        baseY + Math.sin(motionTime * 0.11) * 0.025,
        0,
      );
      updateMoons(motionTime);

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

    const resize = () => {
      const { height, width } = root.getBoundingClientRect();
      if (!width || !height) return;

      const mobile = window.innerWidth < 640;
      const tablet = !mobile && window.innerWidth < 1280;
      const compactDesktop = !mobile && !tablet && window.innerWidth < 1500;
      const pixelRatio = mobile ? 1 : Math.min(window.devicePixelRatio, 1.2);
      const cellWidth = mobile ? 9 : tablet ? 8.5 : VISUAL_CONFIG.asciiCellWidth;
      const cellHeight = mobile ? 11 : tablet ? 10.5 : VISUAL_CONFIG.asciiCellHeight;

      frameDuration = 1000 / (mobile ? 16 : tablet ? 20 : 24);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      renderer.getDrawingBufferSize(drawingSize);

      const columns = Math.max(1, Math.floor(width / cellWidth));
      const rows = Math.max(1, Math.floor(height / cellHeight));
      renderTarget.setSize(columns, rows);
      postMaterial.uniforms.uGridSize.value.set(columns, rows);
      postMaterial.uniforms.uResolution.value.copy(drawingSize);

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      celestial.saturnSystem.scale.setScalar(
        mobile ? 0.7 : tablet ? 0.9 : compactDesktop ? 0.86 : 1,
      );
      baseX = mobile ? -0.05 : tablet ? -0.18 : compactDesktop ? -0.28 : VISUAL_CONFIG.systemX;
      baseY = mobile ? -2.1 : tablet ? -2.25 : compactDesktop ? -2.62 : VISUAL_CONFIG.systemY;

      render(performance.now(), false);
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
        THREE.MathUtils.clamp((event.clientY / window.innerHeight - 0.5) * 0.024, -0.012, 0.012),
        THREE.MathUtils.clamp((event.clientX / window.innerWidth - 0.5) * 0.024, -0.012, 0.012),
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
      celestial.geometries.forEach((geometry) => geometry.dispose());
      celestial.materials.forEach((material) => material.dispose());
      celestial.textures.forEach((texture) => texture.dispose());
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
      <canvas className={`${styles.heroArtCanvas} ${styles.heroArtCanvasTuned}`} ref={canvasRef} />
    </div>
  );
}
