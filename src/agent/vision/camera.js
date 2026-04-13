import { Viewer } from 'prismarine-viewer/viewer/lib/viewer.js';
import { WorldView } from 'prismarine-viewer/viewer/lib/worldView.js';
import { getBufferFromStream } from 'prismarine-viewer/viewer/lib/simpleUtils.js';

import THREE from 'three';
import { createCanvas } from 'node-canvas-webgl/lib/index.js';
import fs from 'fs/promises';
import { Vec3 } from 'vec3';
import { EventEmitter } from 'events';

import worker_threads from 'worker_threads';
global.Worker = worker_threads.Worker;

export class Camera extends EventEmitter {
    constructor (bot, fp) {
        super();
        this.bot = bot;
        this.fp = fp;
        this.viewDistance = 12;
        this.width = 800;
        this.height = 512;
        this.canvas = createCanvas(this.width, this.height);
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas });
        this.viewer = new Viewer(this.renderer);
        this._init().then(() => {
            this.emit('ready');
        });
    }
  
    async _init () {
        if (!this.bot || !this.bot.entity) return;

        try {
            const botPos = this.bot.entity.position;
            const center = new Vec3(botPos.x, botPos.y + this.bot.entity.height, botPos.z);
            
            this.viewer.setVersion(this.bot.version);

            if (this.viewer.entities) {
                this.viewer.entities.update = (entity) => {
                    try {
                        if (!this.viewer.scene || !entity) return;
                        const entityId = entity.id;
                        if (this.viewer.entities.entities[entityId]) {
                            // Logic removed to prevent 1.21.11 entity crashes
                        }
                    } catch (err) { /* ignore */ }
                };
            }

            const worldView = new WorldView(this.bot.world, this.viewDistance, center);
            
            const originalEmit = worldView.emit.bind(worldView);
            worldView.emit = (event, ...args) => {
                if (event === 'entitySpawn') return; 
                try {
                    return originalEmit(event, ...args);
                } catch (err) {
                    return;
                }
            };

            this.viewer.listen(worldView);
            worldView.listenToBot(this.bot);
            await worldView.init(center);
            this.worldView = worldView;
            console.log('[camera.js] 1.21.11 Deep Shield Active');
        } catch (err) {
            console.error('[camera.js] Initialization error:', err);
        }
    }
  
    async capture() {
        const center = new Vec3(this.bot.entity.position.x, this.bot.entity.position.y + this.bot.entity.height, this.bot.entity.position.z);
        this.viewer.camera.position.set(center.x, center.y, center.z);
        await this.worldView.updatePosition(center);
        this.viewer.setFirstPersonCamera(this.bot.entity.position, this.bot.entity.yaw, this.bot.entity.pitch);
        this.viewer.update();
        this.renderer.render(this.viewer.scene, this.viewer.camera);

        const imageStream = this.canvas.createJPEGStream({
            bufsize: 4096,
            quality: 100,
            progressive: false
        });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot_${timestamp}`;

        const buf = await getBufferFromStream(imageStream);
        await this._ensureScreenshotDirectory();
        await fs.writeFile(`${this.fp}/${filename}.jpg`, buf);
        return filename;
    }

    async _ensureScreenshotDirectory() {
        try {
            await fs.access(this.fp);
        } catch (err) {
            await fs.mkdir(this.fp, { recursive: true });
        }
    }
}