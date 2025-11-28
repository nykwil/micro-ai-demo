import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.mouseButtons = {
        LEFT: null, 
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
};

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
// Load from storage
let isAutoplay = localStorage.getItem('isAutoplay') === 'true';

// --- UI Elements ---
const hud = document.createElement('div');
hud.style.position = 'absolute';
hud.style.top = '20px';
hud.style.left = '20px';
hud.style.color = 'white';
hud.style.fontSize = '24px';
hud.style.fontFamily = 'monospace';
hud.innerHTML = `Wave: ${wave} | Health: ${health}%`;
document.body.appendChild(hud);

// Autoplay Toggle
const autoBtn = document.createElement('button');
autoBtn.innerText = isAutoplay ? "Disable Autoplay" : "Enable Autoplay"; 
autoBtn.style.background = isAutoplay ? "#4CAF50" : "";
autoBtn.style.position = 'absolute';
autoBtn.style.top = '20px';
autoBtn.style.right = '20px';
autoBtn.style.padding = '10px';
autoBtn.style.cursor = 'pointer';
autoBtn.onclick = () => {
    isAutoplay = !isAutoplay;
    localStorage.setItem('isAutoplay', isAutoplay);
    autoBtn.innerText = isAutoplay ? "Disable Autoplay" : "Enable Autoplay";
    autoBtn.style.background = isAutoplay ? "#4CAF50" : "";
};
document.body.appendChild(autoBtn);

// Upgrade Screen
const upgradeScreen = document.createElement('div');
upgradeScreen.style.position = 'absolute';
upgradeScreen.style.top = '0';
upgradeScreen.style.left = '0';
upgradeScreen.style.width = '100%';
upgradeScreen.style.height = '100%';
upgradeScreen.style.background = 'rgba(0,0,0,0.85)';
upgradeScreen.style.display = 'none';
upgradeScreen.style.flexDirection = 'column';
upgradeScreen.style.justifyContent = 'center';
upgradeScreen.style.alignItems = 'center';
upgradeScreen.style.zIndex = '100';
upgradeScreen.innerHTML = `<h1 style="color:white; margin-bottom: 10px;">Choose an Upgrade</h1><div id="auto-pick-timer" style="color: yellow; margin-bottom: 20px; font-family: monospace; font-size: 18px;">Auto-picking in 5...</div><div id="cards" style="display:flex; gap:20px;"></div>`;
document.body.appendChild(upgradeScreen);

const waveMsg = document.createElement('div');
waveMsg.style.position = 'absolute';
waveMsg.style.top = '30%';
waveMsg.style.left = '50%';
waveMsg.style.transform = 'translate(-50%, -50%)';
waveMsg.style.color = 'yellow';
waveMsg.style.fontSize = '60px';
waveMsg.style.fontWeight = 'bold';
waveMsg.style.textShadow = '2px 2px 4px #000';
waveMsg.style.fontFamily = 'sans-serif';
waveMsg.style.display = 'none';
document.body.appendChild(waveMsg);

const gameOverScreen = document.createElement('div');
gameOverScreen.style.position = 'absolute';
gameOverScreen.style.top = '50%';
gameOverScreen.style.left = '50%';
gameOverScreen.style.transform = 'translate(-50%, -50%)';
gameOverScreen.style.textAlign = 'center';
gameOverScreen.style.display = 'none';
document.body.appendChild(gameOverScreen);

const gameOverText = document.createElement('div');
gameOverText.innerHTML = "GAME OVER";
gameOverText.style.color = 'red';
gameOverText.style.fontSize = '48px';
gameOverText.style.fontFamily = 'sans-serif';
gameOverText.style.marginBottom = '20px';
gameOverScreen.appendChild(gameOverText);

const restartBtn = document.createElement('button');
restartBtn.innerText = "Try Again";
restartBtn.style.padding = '10px 20px';
restartBtn.style.fontSize = '20px';
restartBtn.style.cursor = 'pointer';
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
                card.style.transform = 'scale(1.1)';
                card.style.boxShadow = '0 0 15px cyan';
                card.style.background = '#444';
            } else {
                card.style.borderColor = '#555';
                card.style.transform = 'scale(1.0)';
                card.style.boxShadow = 'none';
                card.style.background = '#333';
            }
        });
    };

    options.forEach((opt, index) => {
        const card = document.createElement('div');
        card.style.background = '#333';
        card.style.border = '2px solid #555';
        card.style.padding = '20px';
        card.style.width = '150px';
        card.style.textAlign = 'center';
        card.style.cursor = 'pointer';
        card.style.color = 'white';
        card.style.transition = 'all 0.2s ease'; // Smooth transition
        card.innerHTML = `<h3 style="color:cyan">${opt.name}</h3><p>${opt.desc}</p>`;
        
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

window.addEventListener('pointermove', (event) => {
    if (!isAutoplay) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }
});


// --- Animation Loop ---
let lastShotTime = 0;
const baseFireRate = 300; // ms

function animate() {
  requestAnimationFrame(animate);

  if (gameState !== 'PLAYING') return;

  controls.update();
  
  const activeAgentsForHoming = agents.filter(a => a.health > 0);

  // -- Autoplay Logic --
  let nearestAgent = null;
  let minDist = Infinity;

  if (isAutoplay && agents.length > 0) {
      player.updateAutoplay(agents);
      
      // Find nearest
      agents.forEach(a => {
          const d = player.position.distanceToSquared(a.position);
          if (d < minDist) {
              minDist = d;
              nearestAgent = a;
          }
      });
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

      if (isAutoplay && nearestAgent) {
           targetPoint = nearestAgent.position.clone();
      } else {
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
             // Calculate offset angle
             // e.g., if 3 shots: -spread, 0, +spread
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