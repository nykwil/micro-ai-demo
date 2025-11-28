# Micro-AI Survival

A Three.js + Vite 3D survival game demonstrating AI steering behaviors and game mechanics.

## Overview

This is a wave-based survival shooter where you control a player character fighting against AI-controlled enemies. The game features:
- Multiple enemy AI behaviors (Chase, Orbit, Wander, Flee)
- Upgrade system with 12+ different upgrades
- Progressive difficulty with wave-based spawning
- Auto-play mode for demonstration

## Project Structure

```
├── src/
│   ├── main.js         # Game entry point and main game loop
│   ├── Agent.js        # Enemy AI with steering behaviors
│   ├── Player.js       # Player character with controls and stats
│   ├── Bullet.js       # Projectile system with homing/pierce
│   ├── AIManager.js    # Squad-based AI decision making
│   └── style.css       # Base styles
├── public/             # Static assets
├── index.html          # Entry HTML
├── vite.config.js      # Vite configuration (Replit-specific)
└── package.json        # Dependencies
```

## Tech Stack

- **Three.js**: 3D rendering and physics
- **Vite**: Build tool and dev server (using rolldown-vite variant)
- **Vanilla JavaScript**: ES6 modules

## Game Features

### Controls

#### Desktop
- **WASD**: Movement (when Auto-Move is OFF)
- **Mouse**: Aim direction (when Auto-Aim is OFF)
- Auto-fires at aim position

#### Mobile (Touch)
- **Touch anywhere**: Aim at that position (when Auto-Aim is OFF)
- **Auto-Move**: ON by default - player automatically kites enemies
- **Auto-Aim**: OFF by default - tap where you want to shoot

### Control Options
- **Auto-Move Toggle**: Enables AI-controlled movement (kiting, dodging)
- **Auto-Aim Toggle**: Enables automatic targeting of nearest enemy

### Enemy AI States
- **Chase (Red)**: Aggressive pursuit of player
- **Orbit (Yellow)**: Circle around player at distance
- **Wander (Green)**: Random movement
- **Flee (Purple)**: Retreat when damaged/scared

### Upgrades
Between waves, choose from 3 random upgrades:
- Multishot, Damage, Fire Rate, Speed
- Knockback, Spread, Pierce, Bullet Size
- Bullet Speed, Range, Lifesteal, Homing

## Development

### Running Locally
The project is configured to run on port 5000 with Vite dev server.

### Replit Configuration
- Server binds to `0.0.0.0:5000`
- Host verification disabled for Replit proxy
- Hot module replacement enabled

## Deployment

This project is configured for **Static Deployment** on Replit:
- **Build Command**: `npm install && npm run build`
- **Output Directory**: `dist`
- **Deployment Type**: Static (CDN-optimized, no server required)

To deploy:
1. Click "Publish" in the workspace header
2. The app will automatically build and deploy the static files
3. Your game will be served via Replit's CDN

## Recent Changes
- **2024-11-28**: Mobile optimization for vertical gameplay
  - Removed OrbitControls - camera now automatically follows player
  - Split autoplay into separate Auto-Aim and Auto-Move toggles
  - Added touch controls for mobile aiming
  - Redesigned UI for vertical mobile layout (centered HUD, bottom controls)
  - Upgrade cards now display vertically for better mobile UX
  - Auto-Move enabled by default for mobile-friendly experience
- **2024-11-28**: Fixed enemy removal bug
  - Enemies now properly disappear when killed
  - Added break statement in collision loop to prevent index corruption
  - Added geometry/material disposal to prevent memory leaks
- **2024-11-28**: Moved project files to root directory for simpler deployment
  - Simplified project structure (no subdirectory)
  - Updated deployment configuration
  - Configured workflow on port 5000 with webview output
