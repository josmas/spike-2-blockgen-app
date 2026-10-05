# Blockgen

Type a request ("a bubble sort function"), and an LLM builds it as Blockly blocks, using only the blocks that already exist. Runs in the browser; the model is called through OpenRouter with your own key (kept in the browser's local storage). A spike, not a product.

```sh
npm install
npm start          # dev server; paste your OpenRouter key in the panel
npm test           # ~320 offline tests, a few seconds
npm run benchmark -- --help
```

**How it works.** By default the model writes a small JavaScript dialect (or, for Anthropic models, Blockly's nested JSON). The app checks it, translates it into blocks, validates them against the workspace, and retries with line-numbered error messages if anything is wrong. Blockly's own generator then produces the JavaScript.

**Model is set in** `src/config.ts`. Reply format per model: `code` by default, `nested` for Anthropic, `flat` on request.

**More:** [`insights.md`](insights.md) (practical lessons), [`academic_insights.md`](academic_insights.md) (the same as a short report), [`STAGE2_PLAN.md`](STAGE2_PLAN.md) (status and next steps), [`scripts/README.md`](scripts/README.md) (benchmark and tests).
