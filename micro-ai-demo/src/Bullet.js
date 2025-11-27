import * as THREE from 'three';

export class Bullet {
  constructor(scene, position, direction, damage = 1, knockback = 0.5, pierce = 0, size = 1.0, range = 20, bulletSpeedMultiplier = 1.0, homingFactor = 0) {
    this.scene = scene;
    this.position = position.clone();
    
    const speed = 0.8 * bulletSpeedMultiplier;
    this.velocity = direction.clone().normalize().multiplyScalar(speed); 
    
    // Calculate frames to live based on Distance / Speed
    this.lifespan = Math.ceil(range / speed);

    this.radius = 0.2 * size;
    this.isDead = false;
    
    this.damage = damage;
    this.knockback = knockback;
    this.pierceCount = pierce; 
    this.homingFactor = homingFactor;

    // Visuals
    const geometry = new THREE.SphereGeometry(this.radius, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 }); 
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(this.position);
    this.mesh.position.y = 1; 
    
    scene.add(this.mesh);
  }

  update(agents) {
    // Homing Logic (if active)
    if (this.homingFactor > 0 && agents && agents.length > 0) {
        let nearestAgent = null;
        let minDistSq = Infinity;

        // Find nearest living agent
        for (const agent of agents) {
            const distSq = this.position.distanceToSquared(agent.position);
            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearestAgent = agent;
            }
        }

        if (nearestAgent) {
            const desiredDirection = new THREE.Vector3().subVectors(nearestAgent.position, this.position).normalize();
            const steer = new THREE.Vector3().subVectors(desiredDirection.multiplyScalar(this.velocity.length()), this.velocity);
            this.velocity.add(steer.multiplyScalar(this.homingFactor));
            this.velocity.normalize().multiplyScalar(this.velocity.length()); // Maintain speed after homing steer
        }
    }

    this.position.add(this.velocity);
    this.mesh.position.copy(this.position);

    this.lifespan--;
    if (this.lifespan <= 0) {
      this.isDead = true;
      this.kill();
    }
  }

  kill() {
    if (this.isDead) { // Ensure it's not removed multiple times
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
  }

  checkCollision(agent) {
    const dist = this.position.distanceTo(agent.position);
    return dist < (this.radius + agent.radius);
  }
}
