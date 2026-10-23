// Runs level generation off the main thread.
import { generateBatch } from '../core/generator.js';

self.onmessage = (e) => {
  const { id, params } = e.data;
  generateBatch(params, (r) => self.postMessage({ id, type: 'result', result: r }));
  self.postMessage({ id, type: 'done' });
};
