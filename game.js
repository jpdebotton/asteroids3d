// No build step. All geometry, effects, and sounds are generated at runtime.
const $ = id => document.getElementById(id);
let THREE;
try {
  THREE = await import('https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js');
} catch (error) {
  $('error').hidden = false;
  $('error').textContent = 'Three.js could not load. Check your internet connection and reload this page.';
  throw error;
}

const WORLD = { x: 36, y: 23, z: 7 };
const RADII = [0.8, 1.55, 2.8];
const POINTS = [100, 50, 20];
const keys = new Set();
const touchPointers = new Map();
const touchButtons = [...document.querySelectorAll('.touch-button')];
const hasTouch = navigator.maxTouchPoints > 0;
document.documentElement.classList.toggle('supports-touch', hasTouch);
function inputDown(code) {
  return keys.has(code) || [...touchPointers.values()].some(button => button.dataset.key === code);
}
function clearInput() {
  keys.clear();
  const captured = [...touchPointers];
  touchPointers.clear();
  touchButtons.forEach(button => button.classList.remove('is-pressed'));
  for (const [pointerId, button] of captured) {
    if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
  }
}
function updateTouchControls() {
  const visible = hasTouch && mode === 'playing';
  $('touch-controls').hidden = !visible;
  document.documentElement.classList.toggle('playing-touch', visible);
}
const asteroids = [], bullets = [], particles = [];
let mode = 'menu', score = 0, lives = 3, wave = 1;
let heading = 0, cooldown = 0, invincible = 0, nextWave = 0, toastTime = 0;
let previous = 0, accumulator = 0, elapsed = 0, shake = 0;
const velocity = new THREE.Vector3();
const rng = (low, high) => low + Math.random() * (high - low);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#050a13');
const camera = new THREE.OrthographicCamera(-40, 40, 26, -26, 0.1, 180);
camera.position.z = 80;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  $('error').hidden = false;
  $('error').textContent = 'This game needs WebGL. Enable hardware acceleration in your browser and reload.';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('game').appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0x7595b5, 1.15));
const keyLight = new THREE.DirectionalLight(0xb5d8ef, 2.6);
keyLight.position.set(-15, 25, 30);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x3bcdb5, 1.5);
rimLight.position.set(20, -10, -5);
scene.add(rimLight);

// A sparse star field and the wireframe define the full, bounded 3D volume.
const starPositions = [];
for (let i = 0; i < 650; i++) starPositions.push(rng(-100, 100), rng(-75, 75), rng(-55, -15));
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x89a9c1, size: 0.09, transparent: true, opacity: 0.65 })));
const boxGeometry = new THREE.BoxGeometry(WORLD.x * 2, WORLD.y * 2, WORLD.z * 2);
const edges = new THREE.EdgesGeometry(boxGeometry);
boxGeometry.dispose();
scene.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x274251, transparent: true, opacity: 0.45 })));

const ship = new THREE.Group();
const shipGeometry = new THREE.BufferGeometry();
shipGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
  0,1.2,0, -0.8,-0.8,0, 0,-0.38,0.5,
  0,1.2,0, 0,-0.38,0.5, 0.8,-0.8,0,
  0,1.2,0, 0.8,-0.8,0, -0.8,-0.8,0,
  -0.8,-0.8,0, 0.8,-0.8,0, 0,-0.38,0.5,
], 3));
shipGeometry.computeVertexNormals();
ship.add(new THREE.Mesh(shipGeometry, new THREE.MeshStandardMaterial({ color: 0xc6fff3, metalness: 0.5, roughness: 0.28, emissive: 0x176a5b, emissiveIntensity: 0.45 })));
ship.add(new THREE.LineSegments(new THREE.EdgesGeometry(shipGeometry), new THREE.LineBasicMaterial({ color: 0x7bf6d2 })));
const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.7, 6), new THREE.MeshBasicMaterial({ color: 0x7bf6d2, transparent: true, opacity: 0.85 }));
flame.rotation.z = Math.PI;
flame.position.y = -1.4;
ship.add(flame);
const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(1.65, 1), new THREE.MeshBasicMaterial({ color: 0x7bf6d2, wireframe: true, transparent: true, opacity: 0.14 }));
ship.add(shield);
scene.add(ship);
ship.visible = false;

// Shared geometry/materials keep repeated waves and restarts inexpensive.
const rockGeometries = Array.from({ length: 8 }, () => {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const positions = geometry.attributes.position;
  const distortion = new Map();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const id = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (!distortion.has(id)) distortion.set(id, rng(0.76, 1));
    const factor = distortion.get(id);
    positions.setXYZ(i, x * factor, y * factor, z * factor);
  }
  geometry.computeVertexNormals();
  return geometry;
});
const rockMaterials = [0x738d98, 0x657782, 0x657079].map(color => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, metalness: 0.18 }));
const bulletGeometry = new THREE.SphereGeometry(0.19, 6, 4);
const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xbaffea });
const particleGeometry = new THREE.TetrahedronGeometry(1);
const particleMaterials = [0x7bf6d2, 0xf4bd79, 0xa6bbc9].map(color => new THREE.MeshBasicMaterial({ color, transparent: true }));

// AudioContext is created exclusively from a click, never on load or keydown.
class Synth {
  constructor() { this.context = null; this.muted = false; }
  unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.24;
      this.master.connect(this.context.destination);
      this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = this.context.createBufferSource();
      source.buffer = this.noise; source.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 350;
      this.engine = this.context.createGain(); this.engine.gain.value = 0;
      source.connect(filter); filter.connect(this.engine); this.engine.connect(this.master); source.start();
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }
  tone(from, to, duration, volume = 0.25, type = 'sine') {
    if (!this.context || this.context.state !== 'running') return;
    const t = this.context.currentTime;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, t);
    oscillator.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    oscillator.connect(gain); gain.connect(this.master);
    oscillator.start(t); oscillator.stop(t + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  explosion(size) {
    if (!this.context || this.context.state !== 'running') return;
    const t = this.context.currentTime, duration = 0.18 + size * 0.12;
    const source = this.context.createBufferSource(), gain = this.context.createGain(), filter = this.context.createBiquadFilter();
    source.buffer = this.noise;
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(1800, t); filter.frequency.exponentialRampToValueAtTime(80, t + duration);
    gain.gain.setValueAtTime(0.65, t); gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    source.start(t); source.stop(t + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    this.tone(95, 24, duration, 0.45, 'triangle');
  }
  thrust(on) { if (this.context) this.engine.gain.setTargetAtTime(on ? 0.35 : 0, this.context.currentTime, 0.045); }
  toggle() {
    this.muted = !this.muted;
    if (this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.24, this.context.currentTime, 0.02);
    $('mute').textContent = this.muted ? 'SOUND OFF [M]' : 'SOUND ON [M]';
    $('mute').setAttribute('aria-pressed', String(this.muted));
  }
}
const audio = new Synth();
document.addEventListener('click', () => audio.unlock(), { capture: true });

function wrap(position) {
  for (const axis of ['x', 'y', 'z']) {
    const bound = WORLD[axis];
    position[axis] = ((position[axis] + bound) % (bound * 2) + bound * 2) % (bound * 2) - bound;
  }
}
function delta(a, b, bound) {
  let d = a - b;
  if (d > bound) d -= bound * 2;
  if (d < -bound) d += bound * 2;
  return d;
}
function distanceSquared(a, b, useDepth = true) {
  const x = delta(a.x, b.x, WORLD.x), y = delta(a.y, b.y, WORLD.y);
  const z = useDepth ? delta(a.z, b.z, WORLD.z) : 0;
  return x * x + y * y + z * z;
}
function spawnRock(size, position, inherited) {
  const mesh = new THREE.Mesh(rockGeometries[Math.floor(rng(0, rockGeometries.length))], rockMaterials[size]);
  mesh.scale.setScalar(RADII[size]);
  mesh.position.copy(position); wrap(mesh.position);
  mesh.rotation.set(rng(0, 6), rng(0, 6), rng(0, 6));
  const speed = (3 - size) * rng(1.4, 2.5) + Math.min(wave, 15) * 0.23;
  const direction = new THREE.Vector3(rng(-1, 1), rng(-1, 1), rng(-0.3, 0.3)).normalize();
  const movement = direction.multiplyScalar(speed);
  if (inherited) movement.addScaledVector(inherited, 0.35);
  asteroids.push({ mesh, size, velocity: movement, spin: new THREE.Vector3(rng(-0.6, 0.6), rng(-0.6, 0.6), rng(-0.6, 0.6)) });
  scene.add(mesh);
}
function spawnWave() {
  const count = Math.min(4 + wave, 15);
  for (let i = 0; i < count; i++) {
    const position = new THREE.Vector3();
    do { position.set(rng(-WORLD.x, WORLD.x), rng(-WORLD.y, WORLD.y), rng(-WORLD.z, WORLD.z)); }
    while (distanceSquared(position, ship.position, false) < 144);
    spawnRock(2, position);
  }
  announce(`WAVE ${String(wave).padStart(2, '0')} / ${count} CONTACTS`);
  audio.tone(330, 660, 0.35, 0.15);
  updateHUD();
}
function burst(position, count, palette, force = 7) {
  for (let i = 0; i < count && particles.length < 420; i++) {
    const mesh = new THREE.Mesh(particleGeometry, particleMaterials[palette]);
    mesh.position.copy(position);
    const size = rng(0.06, 0.2); mesh.scale.setScalar(size);
    const life = rng(0.3, 0.85);
    particles.push({ mesh, velocity: new THREE.Vector3(rng(-force, force), rng(-force, force), rng(-force, force)), life, maxLife: life, size });
    scene.add(mesh);
  }
}
function remove(array, index) { scene.remove(array[index].mesh); array.splice(index, 1); }
function updateHUD() {
  $('score').textContent = String(score).padStart(6, '0');
  $('wave').textContent = String(wave).padStart(2, '0');
  $('lives').textContent = '△ '.repeat(lives).trim() || '—';
  $('lives').setAttribute('aria-label', `${lives} lives`);
}
function announce(message) { $('toast').textContent = message; toastTime = 2.7; }
function respawn() {
  // Pick the safest of several candidate positions, including the center.
  let safest = new THREE.Vector3(), clearance = -1;
  for (let i = 0; i < 35; i++) {
    const candidate = i === 0 ? new THREE.Vector3() : new THREE.Vector3(rng(-30, 30), rng(-18, 18), 0);
    const nearest = asteroids.reduce((min, rock) => Math.min(min, Math.sqrt(distanceSquared(candidate, rock.mesh.position, false)) - RADII[rock.size]), Infinity);
    if (nearest > clearance) { safest = candidate; clearance = nearest; }
  }
  ship.position.copy(safest); velocity.set(0, 0, 0); heading = 0;
  invincible = 3; ship.visible = true;
}
function start() {
  for (const array of [asteroids, bullets, particles]) while (array.length) remove(array, array.length - 1);
  clearInput(); score = 0; lives = 3; wave = 1; cooldown = 0; nextWave = 0; shake = 0;
  mode = 'playing'; accumulator = 0; respawn(); spawnWave(); updateHUD();
  $('menu').hidden = $('over').hidden = $('paused').hidden = true;
  $('pause').hidden = false;
  updateTouchControls();
  document.activeElement?.blur();
}
function pause() {
  if (mode !== 'playing' && mode !== 'paused') return;
  mode = mode === 'playing' ? 'paused' : 'playing';
  $('paused').hidden = mode !== 'paused';
  clearInput(); audio.thrust(false); accumulator = 0;
  updateTouchControls();
  document.activeElement?.blur();
}
function fire() {
  const direction = new THREE.Vector3(-Math.sin(heading), Math.cos(heading), 0);
  const mesh = new THREE.Mesh(bulletGeometry, bulletMaterial);
  // The elongated pulse covers the volume's depth; arrows control the XY plane.
  mesh.scale.z = WORLD.z / 0.19;
  mesh.position.copy(ship.position).addScaledVector(direction, 1.5); wrap(mesh.position);
  bullets.push({ mesh, velocity: direction.multiplyScalar(43).add(velocity), life: 1.5 });
  scene.add(mesh); cooldown = 0.16;
  audio.tone(1000, 140, 0.13, 0.2, 'sawtooth');
}
function hitRock(index) {
  const rock = asteroids[index], position = rock.mesh.position.clone();
  score += POINTS[rock.size];
  burst(position, 12 + rock.size * 8, rock.size === 2 ? 1 : 2);
  audio.explosion(rock.size); shake = Math.max(shake, 0.12 + rock.size * 0.055);
  remove(asteroids, index);
  if (rock.size > 0) {
    const angle = rng(0, Math.PI * 2), separation = RADII[rock.size - 1] * 0.8;
    for (const sign of [-1, 1]) {
      const offset = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(separation * sign);
      spawnRock(rock.size - 1, position.clone().add(offset), rock.velocity);
    }
  }
  updateHUD();
}
function loseLife() {
  burst(ship.position, 50, 0, 12); audio.explosion(3); shake = 0.65;
  lives--; updateHUD(); clearInput(); audio.thrust(false);
  if (lives > 0) { respawn(); announce('HULL LOST / SHIELD ACTIVE'); }
  else {
    mode = 'over'; ship.visible = false; $('over').hidden = false; $('pause').hidden = true;
    updateTouchControls();
    $('final-score').textContent = String(score).padStart(6, '0');
    $('result').textContent = `You reached wave ${String(wave).padStart(2, '0')}. The field remembers.`;
    $('toast').textContent = ''; audio.tone(220, 45, 0.8, 0.3, 'triangle');
  }
}
function step(dt) {
  if (mode === 'paused') return;
  elapsed += dt;
  for (const rock of asteroids) {
    rock.mesh.position.addScaledVector(rock.velocity, dt); wrap(rock.mesh.position);
    rock.mesh.rotation.x += rock.spin.x * dt;
    rock.mesh.rotation.y += rock.spin.y * dt;
    rock.mesh.rotation.z += rock.spin.z * dt;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i]; particle.life -= dt;
    if (particle.life <= 0) { remove(particles, i); continue; }
    particle.mesh.position.addScaledVector(particle.velocity, dt);
    particle.mesh.scale.setScalar(particle.size * particle.life / particle.maxLife);
  }
  shake = Math.max(0, shake - dt * 1.5);
  if (toastTime > 0) { toastTime -= dt; if (toastTime <= 0) $('toast').textContent = ''; }
  if (mode !== 'playing') return;
  heading += ((inputDown('ArrowLeft') ? 1 : 0) - (inputDown('ArrowRight') ? 1 : 0)) * 3.7 * dt;
  ship.rotation.z = heading;
  const thrusting = inputDown('ArrowUp');
  if (thrusting) {
    velocity.x -= Math.sin(heading) * 19 * dt; velocity.y += Math.cos(heading) * 19 * dt;
    if (velocity.length() > 23) velocity.setLength(23);
    if (Math.random() < 0.45) burst(ship.position.clone().add(new THREE.Vector3(Math.sin(heading), -Math.cos(heading), 0).multiplyScalar(1.15)), 1, 0, 1.8);
  }
  velocity.multiplyScalar(Math.exp(-0.12 * dt));
  ship.position.addScaledVector(velocity, dt); wrap(ship.position);
  flame.visible = thrusting; flame.scale.y = rng(0.65, 1.25); audio.thrust(thrusting);
  invincible = Math.max(0, invincible - dt);
  shield.visible = invincible > 0;
  ship.visible = invincible <= 0 || Math.sin(elapsed * 23) > -0.5;
  cooldown -= dt;
  if (inputDown('Space') && cooldown <= 0) fire();
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i]; bullet.life -= dt;
    if (bullet.life <= 0) { remove(bullets, i); continue; }
    bullet.mesh.position.addScaledVector(bullet.velocity, dt); wrap(bullet.mesh.position);
    for (let j = asteroids.length - 1; j >= 0; j--) {
      if (distanceSquared(bullet.mesh.position, asteroids[j].mesh.position, false) < (RADII[asteroids[j].size] * 0.9 + 0.19) ** 2) {
        hitRock(j); remove(bullets, i); break;
      }
    }
  }
  if (invincible === 0) {
    for (const rock of asteroids) {
      if (distanceSquared(ship.position, rock.mesh.position) < (RADII[rock.size] * 0.85 + 0.65) ** 2) { loseLife(); break; }
    }
  }
  if (asteroids.length === 0 && mode === 'playing') {
    if (nextWave === 0) { nextWave = 2.5; announce('FIELD CLEAR / NEXT WAVE INCOMING'); }
    nextWave -= dt;
    if (nextWave <= 0) { nextWave = 0; wave++; spawnWave(); }
  }
}

$('start').addEventListener('click', start);
$('restart').addEventListener('click', start);
$('pause').addEventListener('click', pause);
$('resume').addEventListener('click', pause);
$('mute').addEventListener('click', () => audio.toggle());
// Track each finger separately; capture keeps releases reliable outside a button.
for (const button of touchButtons) {
  button.addEventListener('pointerdown', event => {
    if (!hasTouch || mode !== 'playing' || event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touchPointers.set(event.pointerId, button);
    button.classList.add('is-pressed');
  });
  const release = event => {
    if (touchPointers.get(event.pointerId) !== button) return;
    touchPointers.delete(event.pointerId);
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    button.classList.toggle('is-pressed', [...touchPointers.values()].includes(button));
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('contextmenu', event => event.preventDefault());
}
window.addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(event.code)) {
    // Preserve native keyboard activation of menu buttons.
    if (mode === 'playing') { event.preventDefault(); keys.add(event.code); }
  }
  if (!event.repeat && event.code === 'KeyP') pause();
  if (!event.repeat && event.code === 'KeyM') audio.toggle();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { clearInput(); if (mode === 'playing') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing') pause(); });
renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault(); if (mode === 'playing') pause();
  $('error').textContent = 'The graphics connection was interrupted. Reload to launch again.'; $('error').hidden = false;
});
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  const aspect = innerWidth / innerHeight;
  const halfHeight = Math.max(29, 40 / aspect);
  camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
  camera.top = halfHeight; camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();
for (let i = 0; i < 10; i++) spawnRock(i % 3, new THREE.Vector3(rng(-34, 34), rng(-21, 21), rng(-7, 7)));
function frame(time) {
  requestAnimationFrame(frame);
  const dt = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
  previous = time; accumulator += dt;
  // Fixed 120 Hz simulation prevents fast shots from tunneling through small rocks.
  while (accumulator >= 1 / 120) { step(1 / 120); accumulator -= 1 / 120; }
  camera.position.x = mode === 'paused' ? 0 : rng(-shake, shake);
  camera.position.y = mode === 'paused' ? 0 : rng(-shake, shake);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
