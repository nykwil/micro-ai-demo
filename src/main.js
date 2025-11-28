import * as THREE from 'three';
import { Agent } from './Agent.js';
import { Player } from './Player.js';
import { Bullet } from './Bullet.js';
import { AIManager } from './AIManager.js';

console.log('Starting Micro-AI Survival Game...');

// --- CONFIGURATION ---
const GameConfig = {
    baseEnemies: 5,
    enemiesPerWave: 5, 
    waveTierFactor: 0.1, // How fast higher tiers appear
};

const UPGRADES = [
    { id: 'multishot', name: 'Double Tap', desc: '+1 Projectile', type: 'multishot' },
    { id: 'damage', name: 'Heavy Rounds', desc: '+1 Damage', type: 'damage' },
    { id: 'fireRate', name: 'Trigger Happy', desc: '+20% Fire Rate', type: 'fireRate' },
    { id: 'speed', name: 'Adrenaline', desc: '+Speed', type: 'speed' },
    { id: 'knockback', name: 'Force Push', desc: '+50% Knockback', type: 'knockback' },
    { id: 'spread', name: 'Wide Shot', desc: '+Spread', type: 'spread' },
    { id: 'pierce', name: 'Piercing Rounds', desc: '+1 Pierce', type: 'pierce' }, // New
    { id: 'bulletSize', name: 'Cannonball', desc: '+25% Bullet Size', type: 'bulletSize' }, // New
    { id: 'bulletSpeed', name: 'High Velocity', desc: '+30% Bullet Speed', type: 'bulletSpeed' }, // Renamed
    { id: 'range', name: 'Long Barrel', desc: '+15 Bullet Range', type: 'range' }, // New Split Upgrade
    { id: 'lifesteal', name: 'Vampirism', desc: '+5% Lifesteal', type: 'lifesteal' }, // New
    { id: 'homing', name: 'Seeker Rounds', desc: '+Homing Power', type: 'homing' } // New
];

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 45, 45); 
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// --- Lights ---
const ambientLight = new THREE.AmbientLight(0x404040); 
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(10, 30, 10);
dirLight.castShadow = true;
dirLight.shadow.camera.top = 50;
dirLight.shadow.camera.bottom = -50;
dirLight.shadow.camera.left = -50;
dirLight.shadow.camera.right = 50;
scene.add(dirLight);

// Ground
const planeGeo = new THREE.PlaneGeometry(100, 100);
const planeMat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide });
const plane = new THREE.Mesh(planeGeo, planeMat);
plane.rotation.x = -Math.PI / 2;
plane.receiveShadow = true;
scene.add(plane);

const gridHelper = new THREE.GridHelper(100, 20);
scene.add(gridHelper);

// --- Game Objects ---
let player = new Player(scene);
let bullets = [];
let aiManager = new AIManager(); 
let agents = []; 

// --- Game State ---
let gameState = 'PLAYING'; // PLAYING, UPGRADING, GAMEOVER
let health = 100;
let wave = 0;
// Load from storage - split autoplay into auto-aim and auto-move
let isAutoAim = localStorage.getItem('isAutoAim') === 'true';
let isAutoMove = localStorage.getItem('isAutoMove') !== 'false'; // Default ON for mobile

// Touch/mouse aim position (used when auto-aim is OFF)
let touchAimPosition = new THREE.Vector3();
let hasTouchTarget = false;

// --- UI Elements ---
const hud = document.createElement('div');
hud.style.position = 'absolute';
hud.style.top = '10px';
hud.style.left = '50%';
hud.style.transform = 'translateX(-50%)';
hud.style.color = 'white';
hud.style.fontSize = '18px';
hud.style.fontFamily = 'monospace';
hud.style.textAlign = 'center';
hud.style.zIndex = '50';
hud.innerHTML = `Wave: ${wave} | Health: ${health}%`;
document.body.appendChild(hud);

// Control buttons container (bottom of screen for mobile)
const controlsContainer = document.createElement('div');
controlsContainer.style.position = 'absolute';
controlsContainer.style.bottom = '20px';
controlsContainer.style.left = '50%';
controlsContainer.style.transform = 'translateX(-50%)';
controlsContainer.style.display = 'flex';
controlsContainer.style.gap = '10px';
controlsContainer.style.zIndex = '50';
document.body.appendChild(controlsContainer);

// Auto-Aim Toggle
const autoAimBtn = document.createElement('button');
autoAimBtn.innerText = isAutoAim ? "Auto-Aim: ON" : "Auto-Aim: OFF";
autoAimBtn.style.background = isAutoAim ? "#4CAF50" : "#666";
autoAimBtn.style.padding = '12px 16px';
autoAimBtn.style.fontSize = '14px';
autoAimBtn.style.border = 'none';
autoAimBtn.style.borderRadius = '8px';
autoAimBtn.style.color = 'white';
autoAimBtn.style.cursor = 'pointer';
autoAimBtn.style.touchAction = 'manipulation';
autoAimBtn.onclick = () => {
    isAutoAim = !isAutoAim;
    localStorage.setItem('isAutoAim', isAutoAim);
    autoAimBtn.innerText = isAutoAim ? "Auto-Aim: ON" : "Auto-Aim: OFF";
    autoAimBtn.style.background = isAutoAim ? "#4CAF50" : "#666";
};
controlsContainer.appendChild(autoAimBtn);

// Auto-Move Toggle
const autoMoveBtn = document.createElement('button');
autoMoveBtn.innerText = isAutoMove ? "Auto-Move: ON" : "Auto-Move: OFF";
autoMoveBtn.style.background = isAutoMove ? "#2196F3" : "#666";
autoMoveBtn.style.padding = '12px 16px';
autoMoveBtn.style.fontSize = '14px';
autoMoveBtn.style.border = 'none';
autoMoveBtn.style.borderRadius = '8px';
autoMoveBtn.style.color = 'white';
autoMoveBtn.style.cursor = 'pointer';
autoMoveBtn.style.touchAction = 'manipulation';
autoMoveBtn.onclick = () => {
    isAutoMove = !isAutoMove;
    localStorage.setItem('isAutoMove', isAutoMove);
    autoMoveBtn.innerText = isAutoMove ? "Auto-Move: ON" : "Auto-Move: OFF";
    autoMoveBtn.style.background = isAutoMove ? "#2196F3" : "#666";
};
controlsContainer.appendChild(autoMoveBtn);

// Upgrade Screen (mobile-optimized vertical layout)
const upgradeScreen = document.createElement('div');
upgradeScreen.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    display: none;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    z-index: 100;
    padding: 20px;
    box-sizing: border-box;
`;
upgradeScreen.innerHTML = `
    <h1 style="color:white; margin-bottom: 8px; font-size: 24px;">Choose an Upgrade</h1>
    <div id="auto-pick-timer" style="color: yellow; margin-bottom: 16px; font-family: monospace; font-size: 16px;">Auto-picking in 5...</div>
    <div id="cards" style="display:flex; flex-direction:column; gap:12px; width:100%; max-width:280px;"></div>
`;
document.body.appendChild(upgradeScreen);

const waveMsg = document.createElement('div');
waveMsg.style.cssText = `
    position: absolute;
    top: 25%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: yellow;
    font-size: 48px;
    font-weight: bold;
    text-shadow: 2px 2px 4px #000;
    font-family: sans-serif;
    display: none;
    text-align: center;
`;
document.body.appendChild(waveMsg);

const gameOverScreen = document.createElement('div');
gameOverScreen.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    display: none;
    z-index: 100;
`;
document.body.appendChild(gameOverScreen);

const gameOverText = document.createElement('div');
gameOverText.innerHTML = "GAME OVER";
gameOverText.style.cssText = `
    color: red;
    font-size: 36px;
    font-family: sans-serif;
    margin-bottom: 20px;
`;
gameOverScreen.appendChild(gameOverText);

const restartBtn = document.createElement('button');
restartBtn.innerText = "Try Again";
restartBtn.style.cssText = `
    padding: 16px 32px;
    font-size: 18px;
    cursor: pointer;
    background: #4CAF50;
    border: none;
    border-radius: 8px;
    color: white;
    touch-action: manipulation;
`;
restartBtn.onclick = initGame;
gameOverScreen.appendChild(restartBtn);


// --- LOGIC ---

function spawnWave() {
    wave++;
    waveMsg.textContent = `WAVE ${wave}`;
    waveMsg.style.display = 'block';
    
    // Scale Squad Size
    // Reduced chasers for better pacing (horde feel vs instant death)
    aiManager.maxChasers = 4 + Math.floor(wave * 1.5); 
    aiManager.maxOrbiters = 20 + Math.floor(wave * 3);

    setTimeout(() => {
        waveMsg.style.display = 'none';
        
        // Calculate Enemy Count
        const count = GameConfig.baseEnemies + (wave * GameConfig.enemiesPerWave);
        
        for(let i=0; i<count; i++) {
            spawnEnemy();
        }
        
    }, 2000);
    
    updateHUD();
}

function spawnEnemy() {
    let pos = new THREE.Vector3();
    const minSpawnDistance = 35; 
    const maxSpawnDistance = 75; 

    do {
        pos.set(
          (Math.random() - 0.5) * maxSpawnDistance * 2,
          1, 
          (Math.random() - 0.5) * maxSpawnDistance * 2
        );
    } while (pos.distanceTo(player.position) < minSpawnDistance);

    // Determine Tier based on Wave
    let tier = 1;
    const r = Math.random();
    
    // Simple probability curve
    const t2Chance = Math.min(0.6, Math.max(0, (wave - 2) * 0.1)); // Starts wave 3
    const t3Chance = Math.min(0.3, Math.max(0, (wave - 5) * 0.1)); // Starts wave 6

    if (r < t3Chance) tier = 3;
    else if (r < t3Chance + t2Chance) tier = 2;

    const agent = new Agent(scene, pos, tier);
    agents.push(agent);
    aiManager.register(agent);
}

let autoPickInterval = null;
let selectedUpgradeIndex = 1;

function showUpgradeScreen() {
    gameState = 'UPGRADING';
    upgradeScreen.style.display = 'flex';
    const cardsDiv = document.getElementById('cards');
    const timerDiv = document.getElementById('auto-pick-timer');
    cardsDiv.innerHTML = '';
    
    let countdown = 5;
    timerDiv.innerText = `Auto-picking in ${countdown}...`;

    if (autoPickInterval) clearInterval(autoPickInterval);

    // Pick 3 UNIQUE random upgrades
    const availableUpgrades = [...UPGRADES]; 
    
    for (let i = availableUpgrades.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableUpgrades[i], availableUpgrades[j]] = [availableUpgrades[j], availableUpgrades[i]];
    }

    const options = availableUpgrades.slice(0, 3);
    
    // Default selection is middle (or 0 if less than 2 cards)
    selectedUpgradeIndex = options.length > 1 ? 1 : 0;

    const updateVisuals = () => {
        Array.from(cardsDiv.children).forEach((card, idx) => {
            if (idx === selectedUpgradeIndex) {
                card.style.borderColor = 'cyan';
                card.style.boxShadow = '0 0 10px cyan';
                card.style.background = '#444';
            } else {
                card.style.borderColor = '#555';
                card.style.boxShadow = 'none';
                card.style.background = '#333';
            }
        });
    };

    options.forEach((opt, index) => {
        const card = document.createElement('div');
        card.style.cssText = `
            background: #333;
            border: 2px solid #555;
            padding: 16px;
            width: 100%;
            text-align: center;
            cursor: pointer;
            color: white;
            border-radius: 12px;
            transition: all 0.2s ease;
            touch-action: manipulation;
            box-sizing: border-box;
        `;
        card.innerHTML = `
            <h3 style="color:cyan; margin: 0 0 4px 0; font-size: 16px;">${opt.name}</h3>
            <p style="margin: 0; font-size: 13px; opacity: 0.9;">${opt.desc}</p>
        `;
        
        card.onmouseover = () => {
            selectedUpgradeIndex = index;
            updateVisuals();
        };
        
        card.onclick = () => {
            if (autoPickInterval) clearInterval(autoPickInterval); 
            player.applyUpgrade(opt.type);
            upgradeScreen.style.display = 'none';
            gameState = 'PLAYING';
            spawnWave(); 
        };
        
        cardsDiv.appendChild(card);
    });
    
    // Apply initial highlighting
    setTimeout(updateVisuals, 0);

    // Start Timer
    autoPickInterval = setInterval(() => {
        countdown--;
        timerDiv.innerText = `Auto-picking in ${countdown}...`;
        if (countdown <= 0) {
            clearInterval(autoPickInterval);
            if (cardsDiv.children[selectedUpgradeIndex]) {
                cardsDiv.children[selectedUpgradeIndex].click();
            }
        }
    }, 1000);
}

function updateHUD() {
    hud.innerHTML = `Wave: ${wave} | Health: ${health}%`;
}

function initGame() {
    // 1. Cleanup Agents
    agents.forEach(a => { 
        scene.remove(a.mesh);
        if(a.mesh.geometry) a.mesh.geometry.dispose();
        if(a.mesh.material) a.mesh.material.dispose();
    });
    agents = [];

    // 2. Cleanup Bullets
    bullets.forEach(b => { 
        b.isDead = true; // Force dead so kill() works
        b.kill(); 
    });
    bullets = [];

    // 3. Cleanup Player
    if (player && player.mesh) {
        scene.remove(player.mesh);
        if (player.mesh.geometry) player.mesh.geometry.dispose();
        if (player.mesh.material) player.mesh.material.dispose();
    }

    aiManager = new AIManager(); 
    
    // Reset Player
    player = new Player(scene); 
    player.position.set(0,1,0);
    player.velocity.set(0,0,0);
    player.stats = {
        speed: 0.07,
        damage: 1,
        fireRate: 1.0,
        projectileCount: 1,
        spread: 0.1,
        knockback: 1.0,
        pierce: 0,
        bulletSize: 1.0,
        bulletSpeed: 1.0,
        range: 20,
        lifestealChance: 0,
        lifestealAmount: 0,
        homingFactor: 0
    };

    health = 100;
    wave = 0;
    gameState = 'PLAYING';
    
    updateHUD();
    hud.style.color = 'white';
    gameOverScreen.style.display = 'none';
    upgradeScreen.style.display = 'none';
    
    spawnWave();
}

// --- Interaction ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Update aim position from mouse/touch
function updateAimFromEvent(event) {
    if (isAutoAim) return; // Skip if auto-aim is enabled
    
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(plane);
    if (intersects.length > 0) {
        touchAimPosition.copy(intersects[0].point);
        touchAimPosition.y = 1;
        hasTouchTarget = true;
    }
}

// Mouse events
window.addEventListener('pointermove', updateAimFromEvent);
window.addEventListener('pointerdown', updateAimFromEvent);

// Touch events for mobile
window.addEventListener('touchstart', (e) => {
    // Don't update aim if touching a button
    if (e.target.tagName === 'BUTTON') return;
    updateAimFromEvent(e);
}, { passive: true });

window.addEventListener('touchmove', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    updateAimFromEvent(e);
}, { passive: true });

window.addEventListener('touchend', () => {
    // Keep the last touch position as target
});


// --- Animation Loop ---
let lastShotTime = 0;
const baseFireRate = 300; // ms

function animate() {
  requestAnimationFrame(animate);

  if (gameState !== 'PLAYING') return;

  const activeAgentsForHoming = agents.filter(a => a.health > 0);

  // Find nearest agent (used for both auto-aim and auto-move)
  let nearestAgent = null;
  let minDist = Infinity;
  
  agents.forEach(a => {
      const d = player.position.distanceToSquared(a.position);
      if (d < minDist) {
          minDist = d;
          nearestAgent = a;
      }
  });

  // -- Movement Logic --
  if (isAutoMove && agents.length > 0) {
      player.updateAutoplay(agents);
  } else {
      player.update();
  }

  // AI Logic
  aiManager.update(player.position);

  // Auto-Fire
  const now = performance.now();
  const currentFireRate = baseFireRate / player.stats.fireRate;
  
  if (now - lastShotTime > currentFireRate) {
      let targetPoint = null;

      // Determine target: auto-aim uses nearest enemy, manual uses touch/mouse position
      if (isAutoAim && nearestAgent) {
          targetPoint = nearestAgent.position.clone();
      } else if (hasTouchTarget) {
          targetPoint = touchAimPosition.clone();
      } else {
          // Fallback: raycast from mouse position
          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObject(plane);
          if (intersects.length > 0) targetPoint = intersects[0].point;
      }

      if (targetPoint) {
          targetPoint.y = 1; 
          const baseDir = new THREE.Vector3().subVectors(targetPoint, player.position).normalize();
          
          // Multishot Logic
          const count = player.stats.projectileCount;
          const spread = player.stats.spread;
          
          for(let i=0; i<count; i++) {
             const angleOffset = (i - (count - 1) / 2) * spread;
             const dir = baseDir.clone();
             dir.applyAxisAngle(new THREE.Vector3(0,1,0), angleOffset);
             
             bullets.push(new Bullet(
                 scene, 
                 player.position, 
                 dir, 
                 player.stats.damage, 
                 player.stats.knockback, 
                 player.stats.pierce, 
                 player.stats.bulletSize, 
                 player.stats.range, 
                 player.stats.bulletSpeed, 
                 player.stats.homingFactor
             ));
          }
          lastShotTime = now;
      }
  }

  // Camera Follow
  const camOffset = new THREE.Vector3(0, 45, 30);
  const desiredCamPos = player.position.clone().add(camOffset);
  camera.position.lerp(desiredCamPos, 0.05);
  camera.lookAt(player.position);

  // Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      // Pass active agents for homing
      b.update(activeAgentsForHoming);
      
      if (b.lifespan <= 0) { 
          b.isDead = true; 
      }
      
      if (b.isDead) {
          b.kill(); // Ensure visual removal
          bullets.splice(i, 1);
      }
  }

  // Agents
  let activeAgents = 0;
  
  for (let i = agents.length - 1; i >= 0; i--) {
    const agent = agents[i];
    activeAgents++;
    
    agent.update(player.position);

    if (agent.checkCollision(player.position, player.radius)) {
      health -= 1; 
      updateHUD();
      hud.style.color = 'red';
      if (health <= 0) {
        health = 0;
        gameState = 'GAMEOVER';
        updateHUD();
        gameOverScreen.style.display = 'block';
      }
    }

        for (let j = bullets.length - 1; j >= 0; j--) {
            const b = bullets[j];

            if (b.checkCollision(agent)) {
                const knock = b.velocity.clone().normalize().multiplyScalar(b.knockback);
                const dead = agent.takeDamage(b.damage, knock);

                if (b.pierceCount > 0) {
                    b.pierceCount--;
                } else {
                    b.isDead = true;
                }

                if (dead) {
                    scene.remove(agent.mesh);
                    if (agent.mesh.geometry) agent.mesh.geometry.dispose();
                    if (agent.mesh.material) agent.mesh.material.dispose();
                    agents.splice(i, 1);
                    aiManager.unregister(agent);
                    activeAgents--;

                    if (player.stats.lifestealChance > 0 && Math.random() < player.stats.lifestealChance) {
                        health = Math.min(100, health + player.stats.lifestealAmount);
                        updateHUD();
                    }
                    break;
                }

                if (b.isDead && b.pierceCount === 0) break;
            }
        }
  }

  if(health > 30 && gameState === 'PLAYING') hud.style.color = 'white';
  
  // Wave Complete?
  if (gameState === 'PLAYING' && wave > 0) {
      if (activeAgents === 0 && waveMsg.style.display === 'none') {
          // Instead of auto-starting next wave, show upgrade screen
          showUpgradeScreen();
      }
  }

  renderer.render(scene, camera);
}

// Handle resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

initGame();
animate();