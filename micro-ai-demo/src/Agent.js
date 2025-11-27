import * as THREE from 'three';

export class Agent {
  constructor(scene, startPos, tier = 1) {
    this.scene = scene;
    this.position = startPos.clone();
    this.velocity = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    
    // Tier Properties
    this.tier = tier;
    this.radius = 0.3 * (1 + (tier - 1) * 0.4); // 0.3, 0.42, 0.54
    this.maxHealth = Math.pow(2, tier - 1); // 1, 2, 4 HP
    this.health = this.maxHealth;
    
    // Physical Props
    this.maxSpeed = 0.08;
    this.maxForce = 0.01;
    this.mass = 1 + (tier - 1) * 0.5; // Heavier if higher tier

    // State
    this.state = 'wander'; 
    this.stateTimer = 0; 
    this.minStateTime = 60; // Minimum frames to hold a state

    // Visuals
    const scale = 1 + (tier - 1) * 0.4;
    const geometry = new THREE.ConeGeometry(this.radius, 1 * scale, 8);
    geometry.rotateX(Math.PI / 2); 
    
    this.material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.position.copy(this.position);
    
    scene.add(this.mesh);
    
    this.wanderAngle = Math.random() * Math.PI * 2;
  }

  takeDamage(amount, knockback) {
      this.health -= amount;
      
      // Flash white
      this.material.emissive.setHex(0xffffff);
      setTimeout(() => { this.material.emissive.setHex(0x000000); }, 50);

      // Apply Knockback
      if (knockback) {
          knockback.divideScalar(this.mass); // Heavier enemies pushed less
          this.acceleration.add(knockback);
      }

      return this.health <= 0;
  }

  setState(newState) {
    if (this.state === newState) return;
    
    // Prevent rapid switching (hysteresis)
    // Exception: Panic (Fleeing) overrides everything.
    if (this.stateTimer < this.minStateTime && newState !== 'flee') {
        return; 
    }
    
    this.state = newState;
    this.stateTimer = 0;

    // Update Visuals & Stats based on State
    switch (newState) {
      case 'chase':
        this.material.color.setHex(0xff0000); // Red
        this.maxSpeed = 0.11; // Fast
        break;
      case 'wander':
        this.material.color.setHex(0x00ff00); // Green
        this.maxSpeed = 0.07; // Slow
        break;
      case 'orbit':
        this.material.color.setHex(0xffff00); // Yellow
        this.maxSpeed = 0.09; // Medium
        break;
      case 'flee':
        this.material.color.setHex(0xaa00ff); // Purple
        this.maxSpeed = 0.12; // Panic speed
        break;
    }
  }

  update(targetPosition) {
    this.stateTimer++;

    // Execute State Behavior
    this.applyBehavior(this.state, targetPosition);

    // Physics Integration
    this.velocity.add(this.acceleration);
    this.velocity.clampLength(0, this.maxSpeed);
    this.position.add(this.velocity);
    this.acceleration.set(0, 0, 0);

    // Strict Bounds (Hard Clamp)
    const limit = 48;
    if (this.position.x > limit) { this.position.x = limit; this.velocity.x = 0; }
    if (this.position.x < -limit) { this.position.x = -limit; this.velocity.x = 0; }
    if (this.position.z > limit) { this.position.z = limit; this.velocity.z = 0; }
    if (this.position.z < -limit) { this.position.z = -limit; this.velocity.z = 0; }

    // Lock Y-Axis (Prevent sinking/flying)
    this.position.y = 1;
    this.velocity.y = 0;
    this.acceleration.y = 0;

    // Update Mesh Position
    this.mesh.position.copy(this.position);

    // Smooth Rotation
    let lookTarget = null;

    if (this.state === 'chase' || this.state === 'orbit') {
        lookTarget = targetPosition.clone();
    } else if (this.state === 'flee') {
        // Look away from target
        const dir = new THREE.Vector3().subVectors(this.position, targetPosition).normalize();
        lookTarget = this.position.clone().add(dir);
    } else {
        // Wander: Look forward
        if (this.velocity.lengthSq() > 0.001) {
            lookTarget = this.position.clone().add(this.velocity);
        }
    }

    if (lookTarget) {
      lookTarget.y = 1; 
      
      const dummy = new THREE.Object3D();
      dummy.position.copy(this.position);
      dummy.lookAt(lookTarget);
      
      // Smoothly rotate towards target
      this.mesh.quaternion.slerp(dummy.quaternion, 0.1); 
    }

    // Unstuck Logic: If fleeing but stuck against a wall, Fight!
    if (this.state === 'flee' && this.velocity.lengthSq() < 0.0001) {
        this.setState('chase');
    }
  }

  checkCollision(targetPos, targetRadius) {
    const dist = this.position.distanceTo(targetPos);
    return dist < (this.radius + targetRadius);
  }

  applyForce(force) {
    force.divideScalar(this.mass);
    this.acceleration.add(force);
  }

  applyBehavior(mode, target) {
    let force = new THREE.Vector3();
    
    switch (mode) {
      case 'chase':
        force = this.seek(target);
        break;
      case 'flee':
        force = this.flee(target);
        break;
      case 'wander':
        force = this.wander();
        break;
      case 'orbit':
        force = this.orbit(target);
        break;
    }

    this.applyForce(force);
  }

  // --- Steering Behaviors ---

  seek(target) {
    const desired = new THREE.Vector3().subVectors(target, this.position);
    desired.normalize().multiplyScalar(this.maxSpeed);
    const steer = new THREE.Vector3().subVectors(desired, this.velocity);
    steer.clampLength(0, this.maxForce);
    return steer;
  }

  flee(target) {
    const desired = new THREE.Vector3().subVectors(this.position, target);
    desired.normalize().multiplyScalar(this.maxSpeed);
    const steer = new THREE.Vector3().subVectors(desired, this.velocity);
    steer.clampLength(0, this.maxForce);
    return steer;
  }

  wander() {
    const circleDist = 2.0;
    const circleRadius = 1.0; 
    const angleChange = 0.2;

    this.wanderAngle += (Math.random() * angleChange - angleChange * 0.5);

    const circleCenter = this.velocity.clone().normalize().multiplyScalar(circleDist);
    const displacement = new THREE.Vector3(0, 0, 1);
    displacement.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.wanderAngle);
    displacement.multiplyScalar(circleRadius);

    const wanderForce = circleCenter.add(displacement);
    
    // Dynamic Wall Avoidance (Weighted away from edges)
    const wallForce = new THREE.Vector3();
    const boundLimit = 48;
    const avoidDist = 15; // Start steering away 15 units from edge

    if (this.position.x > boundLimit - avoidDist) {
        const factor = (this.position.x - (boundLimit - avoidDist)) / avoidDist;
        wallForce.x = -factor;
    }
    if (this.position.x < -boundLimit + avoidDist) {
        const factor = ((-boundLimit + avoidDist) - this.position.x) / avoidDist;
        wallForce.x = factor;
    }
    if (this.position.z > boundLimit - avoidDist) {
        const factor = (this.position.z - (boundLimit - avoidDist)) / avoidDist;
        wallForce.z = -factor;
    }
    if (this.position.z < -boundLimit + avoidDist) {
        const factor = ((-boundLimit + avoidDist) - this.position.z) / avoidDist;
        wallForce.z = factor;
    }

    // Apply strong weight to wall avoidance
    if (wallForce.lengthSq() > 0) {
        wallForce.multiplyScalar(2.0); 
        wanderForce.add(wallForce);
    }

    wanderForce.normalize().multiplyScalar(this.maxSpeed);
    
    const steer = new THREE.Vector3().subVectors(wanderForce, this.velocity);
    steer.clampLength(0, this.maxForce);
    return steer;
  }

  orbit(target) {
    const offset = new THREE.Vector3().subVectors(target, this.position);
    const distance = offset.length();
    
    // Introduce some randomness to the desired orbit radius
    const baseOrbitRadius = 15; 
    const randomOrbitOffset = (Math.sin(this.stateTimer * 0.1) * 0.5 + 0.5) * 5; // Varies between 0 and 5
    const desiredOrbitRadius = baseOrbitRadius + randomOrbitOffset;
    
    // 1. Push/Pull to desired radius
    const radialError = distance - desiredOrbitRadius;
    const radialForce = offset.clone().normalize().multiplyScalar(radialError * 0.05); 
    
    // 2. Move Tangent (spin) with a bit of randomness
    const tangent = new THREE.Vector3().crossVectors(offset, new THREE.Vector3(0, 1, 0)).normalize();
    
    // Add a small random nudge to the tangent direction
    const randomNudge = new THREE.Vector3(
        (Math.random() - 0.5) * 0.2,
        0,
        (Math.random() - 0.5) * 0.2
    );
    tangent.add(randomNudge).normalize();

    tangent.multiplyScalar(this.maxSpeed);
    
    const desired = new THREE.Vector3().addVectors(tangent, radialForce);
    desired.normalize().multiplyScalar(this.maxSpeed);

    const steer = new THREE.Vector3().subVectors(desired, this.velocity);
    steer.clampLength(0, this.maxForce);
    return steer;
  }
}