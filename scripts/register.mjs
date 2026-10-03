// Loaded with `node --import` before the benchmark, so that the resolver hook
// is active by the time the benchmark's own imports are resolved.
import {register} from 'node:module';

register('./hooks.mjs', import.meta.url);
