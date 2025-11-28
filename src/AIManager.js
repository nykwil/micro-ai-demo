export class AIManager {
  constructor() {
    this.agents = [];
    this.frame = 0;
    this.updateInterval = 30; // Update logic every 30 frames
    
    // Squad Tactics
    this.maxChasers = 8;  // More aggression
    this.maxOrbiters = 25; // Massive ring
  }

  register(agent) {
    this.agents.push(agent);
  }

  unregister(agent) {
    const idx = this.agents.indexOf(agent);
    if (idx > -1) this.agents.splice(idx, 1);
  }

  update(playerPos) {
    this.frame++;
    if (this.frame % this.updateInterval !== 0) return;

        // 1. Sort agents by distance to player
        // We still sort to prioritize the 'best' candidates for Chasing/Orbiting
        const sortedAgents = [...this.agents].sort((a, b) => {
          const distA = a.position.distanceToSquared(playerPos);
          const distB = b.position.distanceToSquared(playerPos);
          return distA - distB;
        });
    
            let chaserCount = 0;
            let orbiterCount = 0;
            let fleeCount = 0; // Track cowards
        
            for (let agent of sortedAgents) {
              if (agent.state === 'flee') {
                  fleeCount++; // Count existing fleeing agents
              }
            }
        
            for (let agent of sortedAgents) {
              const dist = agent.position.distanceTo(playerPos);
              const isInjured = agent.health < agent.maxHealth;
        
                    // 1. Panic Check (Injured or Nervous)
                    // Chasers are BRAVE. They ignore random panic.
                    if (agent.state !== 'chase' && fleeCount < 2) {
                        // Injured: 15% chance, Healthy: 2% chance
                        const fleeChance = isInjured ? 0.15 : 0.02;
                        
                        if (Math.random() < fleeChance) {
                            agent.setState('flee');
                            fleeCount++;
                            continue;
                        }
                    }              
              // If already fleeing (and valid timeframe), let them run
              if (agent.state === 'flee') continue;
        
      // 2. FILL CHASER SLOTS FIRST
      if (chaserCount < this.maxChasers) {
          agent.setState('chase');
          chaserCount++;
          continue; 
      }
            
                  // 3. Fallback: Massive Orbit
                  // Extended range to 60 to capture more mid-field agents into orbit
                  if (dist < 60) {
                       if (orbiterCount < this.maxOrbiters) {
                           agent.setState('orbit');
                           orbiterCount++;
                       } else {
                           agent.setState('wander');
                       }
                  }
      // 4. Far Range
      else {
           agent.setState('wander');
      }
    }
  }
}
