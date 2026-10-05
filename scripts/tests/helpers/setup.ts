// Import this first in every test file. Registers the app's custom block and
// silences the app's logging and Blockly's warnings, which are only noise here.
import {setLogSink} from '../../../src/log';
import {registerBlocks} from '../../../src/register';

registerBlocks();
setLogSink(() => {});
console.warn = () => {};
