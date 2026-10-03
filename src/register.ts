import * as Blockly from 'blockly/core';
import {javascriptGenerator} from 'blockly/javascript';
import {blocks} from './blocks/text';
import {forBlock} from './generators/javascript';

/**
 * Registers this app's custom blocks and their JavaScript generators.
 * Shared by the browser app and the benchmark script, so both see the same
 * set of blocks.
 */
export function registerBlocks(): void {
  Blockly.common.defineBlocks(blocks);
  Object.assign(javascriptGenerator.forBlock, forBlock);
}
