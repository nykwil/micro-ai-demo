import * as THREE from 'three';

export class Player {
  constructor(scene) {
    this.position = new THREE.Vector3(0, 1, 0);
    this.velocity = new THREE.Vector3();
    this.friction = 0.9; 
    this.radius = 0.5;

    // --- Stats (Tunable & Upgradable) ---
    this.stats = {
      speed: 0.07,
      damage: 1,
      fireRate: 1.0,      
      projectileCount: 1, 
      spread: 0.1,        
      knockback: 1.0,     
      pierce: 0,          // New: Can pierce through X enemies
      bulletSize: 1.0,    // New: Multiplier for bullet radius
      bulletSpeed: 1.0,   // New: Multiplier for bullet velocity
      range: 20,          // New: Distance bullet travels (units)
      lifestealChance: 0, // New: % chance to heal on kill (0-1)
      lifestealAmount: 0, // New: Flat health to restore on lifesteal
      homingFactor: 0     // New: How strongly bullets steer towards enemies (0-1)
    };

    // Visuals
    const geometry = new THREE.SphereGeometry(this.radius, 32, 32);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x0088ff, 
      roughness: 0.1, 
      metalness: 0.1 
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.position.copy(this.position);
    scene.add(this.mesh);

    // Input state
    this.keys = {
      w: false, a: false, s: false, d: false
    };

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  applyUpgrade(type) {
    switch(type) {
        case 'speed': 
            this.stats.speed += 0.01; 
            break;
        case 'damage': 
            this.stats.damage += 1; 
            break;
        case 'fireRate': 
            this.stats.fireRate += 0.2; 
            break;
        case 'multishot': 
            this.stats.projectileCount += 1; 
            break;
        case 'spread': 
            this.stats.spread += 0.1; 
            break;
        case 'knockback': 
            this.stats.knockback += 0.5; 
            break;
        case 'pierce': // New upgrade
            this.stats.pierce += 1;
            break;
        case 'bulletSize': // New upgrade
            this.stats.bulletSize += 0.25; // Increase size by 25%
            break;
        case 'bulletSpeed': // Renamed: High Velocity
            this.stats.bulletSpeed += 0.3;
            break;
        case 'range': // New: Long Barrel
            this.stats.range += 15;
            break;
        case 'lifesteal': // New upgrade
            this.stats.lifestealChance = Math.min(1.0, this.stats.lifestealChance + 0.05); // Max 100%
            this.stats.lifestealAmount += 5;
            break;
        case 'homing': // New upgrade
            this.stats.homingFactor += 0.05; // Incremental homing
            break;
    }
  }

  onKey(event, isDown) {
    const key = event.key.toLowerCase();
    if (this.keys.hasOwnProperty(key)) {
      this.keys[key] = isDown;
    }
  }

  update() {
    // Input Force
    const inputVector = new THREE.Vector3(0, 0, 0);
    if (this.keys.w) inputVector.z -= 1;
    if (this.keys.s) inputVector.z += 1;
    if (this.keys.a) inputVector.x -= 1;
    if (this.keys.d) inputVector.x += 1;

    // Normalize and apply speed
    if (inputVector.length() > 0) {
      inputVector.normalize().multiplyScalar(this.stats.speed * 0.5); 
      this.velocity.add(inputVector);
    }

    // Apply friction/damping
    this.velocity.multiplyScalar(this.friction);

    // Apply Velocity
    this.position.add(this.velocity);

    // Bounds checking (simple box 50x50)
    const limit = 45; 
    if (this.position.x > limit) this.position.x = limit;
    if (this.position.x < -limit) this.position.x = -limit;
    if (this.position.z > limit) this.position.z = limit;
    if (this.position.z < -limit) this.position.z = -limit;

    // Sync mesh
    this.mesh.position.copy(this.position);
  }

  updateAutoplay(agents) {
    const totalForce = new THREE.Vector3();
    const separation = new THREE.Vector3();
    let count = 0;
    
    let nearestAgent = null;
    let minDistSq = Infinity;

    // 1. Scan Environment
    agents.forEach(agent => {
      const distSq = this.position.distanceToSquared(agent.position);
      
      // Track Nearest
      if (distSq < minDistSq) {
          minDistSq = distSq;
          nearestAgent = agent;
      }

      // Crowd Separation (Don't get surrounded)
      if (distSq < 225) { // 15^2 radius
        const dist = Math.sqrt(distSq);
        const push = new THREE.Vector3().subVectors(this.position, agent.position);
        push.normalize();
        push.divideScalar(dist); // Stronger when closer
        separation.add(push);
        count++;
      }
    });

    // 2. Apply Separation
    if (count > 0) {
      separation.divideScalar(count);
      separation.normalize().multiplyScalar(this.stats.speed * 1.2); 
      totalForce.add(separation);
    }

    // 3. Kiting Logic (Aggressive but Safe)
    if (nearestAgent) {
        const dist = Math.sqrt(minDistSq);
        const dir = new THREE.Vector3().subVectors(nearestAgent.position, this.position).normalize();
        
        // Deadzone / Comfort Zone Logic
        // Widened zone to prevent jitter
        const minSafeDist = 8;
        const maxChaseDist = Math.max(12, this.stats.range * 0.7); // Stop if within 70% of max range (but at least 12)

        if (dist > maxChaseDist) {
            // Chase (Too far)
            totalForce.add(dir.multiplyScalar(this.stats.speed * 0.5));
        } else if (dist < minSafeDist) {
            // Flee (Too close)
            totalForce.add(dir.multiplyScalar(-1 * this.stats.speed * 1.5));
        } 
        // Else: Hold Ground
    }

    // 4. Wall Avoidance (Critical Priority)
    const wallForce = new THREE.Vector3();
    const boundLimit = 45;
    const buffer = 8; // Reduced buffer to allow corner sniping

    if (this.position.x > boundLimit - buffer) wallForce.x = -1;
    if (this.position.x < -boundLimit + buffer) wallForce.x = 1;
    if (this.position.z > boundLimit - buffer) wallForce.z = -1;
    if (this.position.z < -boundLimit + buffer) wallForce.z = 1;

    if (wallForce.lengthSq() > 0) {
        // Strongest force: Override everything to stay on board
        wallForce.normalize().multiplyScalar(this.stats.speed * 2.5); 
        totalForce.add(wallForce);
    }

    // Apply Physics
    this.velocity.add(totalForce);
    this.velocity.clampLength(0, this.stats.speed); // Cap max speed
    this.position.add(this.velocity);

    // Hard Clamp Failsafe
    this.position.x = Math.max(-boundLimit, Math.min(boundLimit, this.position.x));
    this.position.z = Math.max(-boundLimit, Math.min(boundLimit, this.position.z));

    this.mesh.position.copy(this.position);
  }
}
