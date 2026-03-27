// Custom ESM loader to handle file types Node.js doesn't natively support
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./loader-hooks.mjs', pathToFileURL('./'));
