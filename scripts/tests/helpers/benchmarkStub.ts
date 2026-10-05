// Preloaded (node --import) into the benchmark CLI by the benchmark tests, so
// the real CLI runs end to end against a fake OpenRouter. The model name picks
// the scenario.
import {installFakeOpenRouter} from './fakeOpenRouter';
import {BUBBLE_SORT} from './fixtures';

const reply = (code: string) => JSON.stringify({summary: 'a sorting function', code, unsupported: []});
const ES6 = 'const bubbleSort = (a) => a.sort();\nconsole.log(`${bubbleSort([3, 1, 2])}`);';
const CLASSY = 'class Sorter { sort() { return 1; } }\nvar s = new Sorter({a: 1});';

installFakeOpenRouter(
  ({model, retry}) => {
    switch (model) {
      case 'fake/good':
        return {text: reply(BUBBLE_SORT)};
      case 'fake/retries':
        return {text: reply(retry ? BUBBLE_SORT : ES6)};
      case 'fake/broken':
        return {text: reply(CLASSY)};
      case 'fake/down':
        return {status: 400, body: '{"error":{"message":"Provider returned error","code":400}}'};
      default:
        return {status: 404, body: `unexpected model ${model}`};
    }
  },
  ['fake/good', 'fake/retries', 'fake/broken', 'fake/down'],
);
