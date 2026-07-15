import * as THREE from 'three';
import { createFractalMaterial } from './Simple_FractalDithering.js';

async function runExample() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2');
  if (!context) {
    console.error('WebGL2 not supported in this browser.');
    return;
  }

  const renderer = new THREE.WebGLRenderer({ canvas, context });
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10);
  camera.position.z = 2;

  // Load texture
  const loader = new THREE.TextureLoader();
  const texture = await new Promise((res, rej) => loader.load('textures/default.jpg', res, undefined, rej));

  const material = await createFractalMaterial({ map: texture, level: 3 });

  const geo = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geo, material);
  scene.add(mesh);

  function onResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  onResize();

  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}

runExample().catch(console.error);
