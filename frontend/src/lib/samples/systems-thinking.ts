/**
 * Sample render-contract content (a systems-thinking primer) for the styleguide,
 * the home page and tests. Exercises every block type and most span features.
 */
import type { CalloutBlock, ChartBlock, RenderBlock } from '../contract';

export const SAMPLE_TITLE = 'Thinking in Systems — chapter 1 distillation';

export const stockChart: ChartBlock = {
  type: 'chart',
  kind: 'line',
  title: 'A bathtub with a delayed tap: water level against the target',
  x: { label: 'Minute', values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  y: { label: 'Litres in the tub' },
  series: [
    { name: 'Water level', values: [20, 34, 46, 55, 60, 61, 58, 53, 49, 47, 47, 48, 50] },
    { name: 'Target level', values: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50] },
  ],
  cites: ['ch01/s03/p004'],
  confidence: 'medium',
};

export const leverageChart: ChartBlock = {
  type: 'chart',
  kind: 'bar',
  title: 'Reported effect of interventions, by leverage point',
  x: { label: 'Leverage point', values: ['Parameters', 'Buffers', 'Delays', 'Feedback', 'Rules', 'Goals'] },
  y: { label: 'Median effect size' },
  series: [
    { name: 'Short term', values: [0.8, 1.1, 1.6, 2.4, 3.1, 3.6] },
    { name: 'Long term', values: [0.3, 0.7, 1.9, 3.2, 4.4, null] },
  ],
  cites: ['ch06/s01/p002', 'ch06/s02/p011'],
};

export const scatterChart: ChartBlock = {
  type: 'chart',
  kind: 'scatter',
  title: 'Delay length against oscillation amplitude',
  x: { label: 'Perception delay (days)', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  y: { label: 'Overshoot (%)' },
  series: [{ name: 'Simulated runs', values: [2, 5, 7, 12, 14, 19, 24, 26, 33, 38] }],
  cites: ['ch01/s04/p009'],
  confidence: 'low',
};

export const sampleBlocks: RenderBlock[] = [
  { type: 'heading', level: 2, text: 'Stocks, flows and the shape of delay' },
  {
    type: 'paragraph',
    spans: [
      { text: 'A system is more than the sum of its parts:', cites: [] },
      { text: 'its behaviour comes from how the parts are connected', mark: 'strong', cites: ['ch01/s01/p003'] },
      { text: ', not from the parts themselves. Change every player on a team and it is', cites: [] },
      { text: 'still recognisably the same team', mark: 'em', cites: ['ch01/s01/p006'] },
      { text: '.', cites: [] },
    ],
  },
  {
    type: 'definition',
    term: 'stock',
    spans: [
      { text: 'An accumulation you could count or measure at a single moment — water in a tub, money in an account, trust in a relationship.', cites: ['ch01/s02/p001'] },
    ],
  },
  {
    type: 'paragraph',
    spans: [
      { text: 'Stocks change only through flows, and', cites: [] },
      { text: 'they change slowly even when flows change fast', mark: 'highlight', cites: ['ch01/s02/p008', 'ch01/s02/p009'] },
      { text: '. That lag is a buffer, and it is also the source of most surprises. In the model below the flow is', cites: [] },
      { text: 'inflow - outflow', mark: 'code', cites: [] },
      { text: '.', cites: [] },
    ],
  },
  {
    type: 'callout',
    tone: 'insight',
    title: 'Delays make stable systems oscillate',
    spans: [
      { text: 'A balancing loop that reacts to old information keeps correcting after the correction is no longer needed.', cites: ['ch01/s04/p002'] },
    ],
  },
  {
    type: 'bullets',
    items: [
      [{ text: 'Reinforcing loops amplify whatever is happening, in either direction.', cites: ['ch01/s03/p010'] }],
      [{ text: 'Balancing loops pull a stock toward a goal.', cites: ['ch01/s03/p012'] }],
      [
        { text: 'Delays sit on the', cites: [] },
        { text: 'information', mark: 'em', cites: [] },
        { text: 'arrows as often as on the material ones.', cites: ['ch01/s04/p005'] },
      ],
    ],
  },
  {
    type: 'steps',
    items: [
      [{ text: 'Name the stock and the goal it is being pulled toward.', cites: ['ch01/s03/p013'] }],
      [{ text: 'Trace the information the decision-maker actually sees, and when.', cites: ['ch01/s04/p006'] }],
      [{ text: 'Measure the delay before changing the response speed.', cites: ['ch01/s04/p008'] }],
    ],
  },
  stockChart,
  {
    type: 'diagram',
    direction: 'LR',
    nodes: [
      { id: 'pop', label: 'Population' },
      { id: 'births', label: 'Births' },
      { id: 'deaths', label: 'Deaths' },
      { id: 'food', label: 'Food per person' },
    ],
    edges: [
      { from: 'births', to: 'pop', label: 'adds' },
      { from: 'pop', to: 'births', label: 'more parents' },
      { from: 'pop', to: 'deaths' },
      { from: 'deaths', to: 'pop', label: 'removes' },
      { from: 'pop', to: 'food', label: 'dilutes' },
      { from: 'food', to: 'deaths', label: 'scarcity raises' },
    ],
    cites: ['ch01/s05/p001', 'ch01/s05/p004'],
    confidence: 'high',
  },
  {
    type: 'table',
    caption: 'Places to intervene, weakest first',
    header: ['Leverage point', 'Example', 'Rank'],
    rows: [
      [
        { text: 'Parameters', cites: ['ch06/s01/p002'] },
        { text: 'Subsidies, taxes, standards', cites: [] },
        { text: '12', cites: [] },
      ],
      [
        { text: 'Delays', cites: ['ch06/s03/p001'] },
        { text: 'Reporting lag on inventory', cites: [] },
        { text: '9', cites: [] },
      ],
      [
        { text: 'Rules', cites: ['ch06/s05/p004'] },
        { text: 'Incentives, constraints, punishments', cites: [] },
        { text: '5', cites: [] },
      ],
      [
        { text: 'Paradigms', mark: 'strong', cites: ['ch06/s09/p002'] },
        { text: 'The shared idea the system arises from', cites: [] },
        { text: '2', cites: [] },
      ],
    ],
  },
  {
    type: 'code',
    language: 'python',
    caption: 'The bathtub, one minute at a time',
    text: `def simulate(level: float, target: float, minutes: int, delay: int = 2) -> list[float]:
    """Refill toward target, reacting to what the level was \`delay\` minutes ago."""
    history = [level]
    for t in range(minutes):
        seen = history[max(0, t - delay)]
        inflow = max(0.0, (target - seen) * 0.4)
        history.append(history[-1] + inflow - 2.0)  # constant drain
    return history`,
    cites: ['ch01/s03/p004'],
  },
  {
    type: 'math',
    latex: 'S(t) = S(t_0) + \\int_{t_0}^{t} \\big(\\mathrm{inflow}(s) - \\mathrm{outflow}(s)\\big)\\,ds',
    meaning: [
      { text: 'A stock is its starting level plus everything that flowed in, minus everything that flowed out.', cites: ['ch01/s02/p004'] },
    ],
    cites: ['ch01/s02/p004'],
  },
  {
    type: 'quote',
    text: 'You think that because you understand “one” that you must therefore understand “two” because one and one make two. But you forget that you must also understand “and.”',
    attribution: 'Sufi teaching story, as quoted',
    cites: ['ch01/s01/p001'],
    page: 12,
  },
  {
    type: 'callout',
    tone: 'antipattern',
    spans: [
      { text: 'Pushing harder on a parameter when the delay is the real problem.', cites: ['ch06/s01/p005'] },
    ],
  },
];

/** One callout per tone, for the tone specimen. */
export const toneCallouts: CalloutBlock[] = [
  { type: 'callout', tone: 'important', title: 'Structure produces behaviour', spans: [{ text: 'Look for the loop before blaming the actor inside it.', cites: ['ch01/s01/p009'] }] },
  { type: 'callout', tone: 'remember', spans: [{ text: 'Stocks change only through flows.', cites: ['ch01/s02/p002'] }] },
  { type: 'callout', tone: 'antipattern', title: 'Fixing the symptom', spans: [{ text: 'Adding capacity to a queue fed by a reinforcing loop only moves the queue.', cites: ['ch05/s02/p003'] }] },
  { type: 'callout', tone: 'insight', spans: [{ text: 'Resilience usually costs efficiency, and the cost is visible long before the benefit.', cites: ['ch03/s01/p006'] }] },
  { type: 'callout', tone: 'caution', spans: [{ text: 'The model assumes a constant drain; real outflows respond to the stock.', cites: ['ch01/s03/p005'] }] },
  { type: 'callout', tone: 'contrast', title: 'Against linear forecasting', spans: [{ text: 'Trend extrapolation ignores the loop that will eventually bend the trend.', cites: ['ch04/s01/p002'] }] },
  { type: 'callout', tone: 'question', spans: [{ text: 'Which of your own stocks do you only ever see through a delayed report?', cites: [] }] },
];
