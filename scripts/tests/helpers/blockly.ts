import * as Blockly from 'blockly/core';
import {javascriptGenerator} from 'blockly/javascript';
import {appendResponse} from '../../../src/append';
import type {ModelResponse} from '../../../src/llm/parse';

/** Loads a nested response into a fresh headless workspace and returns Blockly's generated JavaScript. */
export function generateJs(response: ModelResponse): string {
  const ws = new Blockly.Workspace();
  appendResponse(ws, JSON.parse(JSON.stringify(response)));
  const code = javascriptGenerator.workspaceToCode(ws);
  ws.dispose();
  return code;
}

export const newWorkspace = (): Blockly.Workspace => new Blockly.Workspace();
